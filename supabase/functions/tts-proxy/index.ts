import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY")

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        if (!GOOGLE_AI_KEY) throw new Error("GOOGLE_AI_KEY não configurada.")

        const { text, voice } = await req.json()
        if (!text?.trim()) {
            return new Response(JSON.stringify({ error: "Texto vazio" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        const safeText = text.slice(0, 4000) // Permitir até 4000 caracteres
        const selectedVoice = voice || 'Puck'

        console.log(`[TTS Stream] Iniciando. Voz: ${selectedVoice}, Texto: ${safeText.substring(0, 30)}...`)

        // Cria o stream de resposta
        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder()
                const log = (msg: string) => console.log(`[TTS Stream Internal] ${msg}`)

                const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_AI_KEY}`
                
                let ws: WebSocket
                try {
                    ws = new WebSocket(geminiUrl)
                } catch (err: any) {
                    log(`Erro ao instanciar WebSocket: ${err.message || err}`)
                    controller.close()
                    return
                }

                // Timeout de segurança de 40 segundos
                const timeoutId = setTimeout(() => {
                    log("Timeout interno atingido!")
                    cleanup()
                    controller.close()
                }, 40000)

                const cleanup = () => {
                    clearTimeout(timeoutId)
                    try {
                        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                            ws.close()
                        }
                    } catch (_) {}
                }

                ws.onopen = () => {
                    log("WebSocket aberto.")
                    
                    const setupMessage = {
                        setup: {
                            model: "models/gemini-2.5-flash-native-audio-latest",
                            generationConfig: {
                                responseModalities: ["AUDIO"],
                                temperature: 0,
                                speechConfig: {
                                    voiceConfig: {
                                        prebuiltVoiceConfig: {
                                            voiceName: selectedVoice
                                        }
                                    }
                                }
                            },
                            systemInstruction: {
                                parts: [
                                    {
                                        text: "Você é um leitor de texto em voz alta (Text-to-Speech). Sua única função é ler o texto fornecido pelo usuário em português, de forma natural, palavra por palavra, exatamente como escrito. NÃO responda ao texto, NÃO adicione comentários, NÃO agradeça e NÃO faça perguntas. Apenas leia o texto fornecido pelo usuário."
                                    }
                                ]
                            }
                        }
                    }
                    
                    const contentMessage = {
                        clientContent: {
                            turns: [
                                {
                                    role: "user",
                                    parts: [
                                        {
                                            text: `Leia o seguinte texto em voz alta, exatamente como escrito, sem adicionar comentários ou respostas:\n\n${safeText}`
                                        }
                                    ]
                                }
                            ],
                            turnComplete: true
                        }
                    }

                    try {
                        ws.send(JSON.stringify(setupMessage))
                        ws.send(JSON.stringify(contentMessage))
                        log("Setup e conteúdo enviados.")
                    } catch (sendErr: any) {
                        log(`Erro de envio: ${sendErr.message || sendErr}`)
                        cleanup()
                        controller.close()
                    }
                }

                ws.onmessage = async (event) => {
                    try {
                        let textData = ""
                        if (event.data instanceof Blob) {
                            textData = await event.data.text()
                        } else if (typeof event.data === "string") {
                            textData = event.data
                        } else if (event.data instanceof ArrayBuffer) {
                            textData = new TextDecoder().decode(event.data)
                        } else {
                            textData = new TextDecoder().decode(new Uint8Array(event.data))
                        }

                        const response = JSON.parse(textData)
                        
                        const modelTurn = response.serverContent?.modelTurn
                        if (modelTurn?.parts) {
                            for (const part of modelTurn.parts) {
                                if (part.inlineData?.data) {
                                    // Envia o chunk base64 seguido de quebra de linha para o stream
                                    controller.enqueue(encoder.encode(part.inlineData.data + "\n"))
                                }
                            }
                        }

                        if (response.serverContent?.turnComplete) {
                            log("Turno completo recebido.")
                            cleanup()
                            controller.close()
                        }
                    } catch (parseErr: any) {
                        log(`Erro no parse de mensagem: ${parseErr.message || parseErr}`)
                    }
                }

                ws.onerror = (errEvent: any) => {
                    log(`Erro no WebSocket: ${errEvent.message || "Erro desconhecido"}`)
                    cleanup()
                    controller.close()
                }

                ws.onclose = () => {
                    log("WebSocket fechado.")
                    cleanup()
                    controller.close()
                }
            }
        })

        return new Response(stream, {
            status: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        })

    } catch (error: any) {
        console.error("[TTS Stream Error] final:", error)
        return new Response(JSON.stringify({ error: error.message || String(error) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
    }
})
