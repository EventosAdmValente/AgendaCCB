import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY")

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
}

function combineBase64AudioChunks(chunks: string[]): string {
    const arrays = chunks.map(chunk => {
        const binary = atob(chunk)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes
    })
    const totalLen = arrays.reduce((acc, a) => acc + a.length, 0)
    const combined = new Uint8Array(totalLen)
    let offset = 0
    for (const a of arrays) { combined.set(a, offset); offset += a.length }
    let binary = ''
    for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i])
    return btoa(binary)
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const logs: string[] = []
    const log = (msg: string) => {
        const entry = `[${new Date().toISOString()}] ${msg}`
        console.log(entry)
        logs.push(entry)
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

        const safeText = text.slice(0, 2000)
        const selectedVoice = voice || 'Puck'

        log(`Iniciando TTS com WebSocket nativo. Voz: ${selectedVoice}, Texto: ${safeText.substring(0, 30)}...`)

        const audioChunks: string[] = []
        let detectedMime = 'audio/pcm;rate=24000'

        await new Promise<void>((resolve, reject) => {
            const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_AI_KEY}`
            log(`Abrindo WebSocket para o Gemini...`)

            let ws: WebSocket
            try {
                ws = new WebSocket(geminiUrl)
            } catch (err: any) {
                log(`Falha ao instanciar WebSocket: ${err.message || err}`)
                return reject(err)
            }

            const timeoutId = setTimeout(() => {
                log("Timeout de 26 segundos atingido!")
                cleanup()
                if (audioChunks.length > 0) {
                    log(`Timeout atingido, mas temos ${audioChunks.length} chunks de áudio. Resolvendo...`)
                    resolve()
                } else {
                    reject(new Error(`Timeout aguardando áudio da Live API. Logs: ${logs.join(" | ")}`))
                }
            }, 26000)

            const cleanup = () => {
                clearTimeout(timeoutId)
                try {
                    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                        ws.close()
                    }
                } catch (_) {}
            }

            ws.onopen = () => {
                log("Conexão WebSocket aberta com sucesso.")
                
                // Enviar setup
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
                            parts: [{
                                text: "Read the provided text aloud in Brazilian Portuguese exactly as given."
                            }]
                        }
                    }
                }
                
                // Enviar texto
                const contentMessage = {
                    clientContent: {
                        turns: [
                            {
                                role: "user",
                                parts: [
                                    {
                                        text: safeText
                                    }
                                ]
                            }
                        ],
                        turnComplete: true
                    }
                }

                try {
                    ws.send(JSON.stringify(setupMessage))
                    log("Mensagem de Setup enviada.")
                    ws.send(JSON.stringify(contentMessage))
                    log("Mensagem de Conteúdo enviada.")
                } catch (sendErr: any) {
                    log(`Erro ao enviar mensagens no WebSocket: ${sendErr.message || sendErr}`)
                    cleanup()
                    reject(sendErr)
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
                    
                    // Verificar se é serverContent
                    const modelTurn = response.serverContent?.modelTurn
                    if (modelTurn?.parts) {
                        for (const part of modelTurn.parts) {
                            if (part.inlineData?.data) {
                                audioChunks.push(part.inlineData.data)
                                if (part.inlineData.mimeType) {
                                    detectedMime = part.inlineData.mimeType
                                }
                            }
                        }
                    }

                    // Verificar se o turno acabou
                    if (response.serverContent?.turnComplete) {
                        log(`Turno completo recebido. Total de chunks: ${audioChunks.length}`)
                        cleanup()
                        resolve()
                    }
                } catch (parseErr: any) {
                    log(`Erro ao processar mensagem do WebSocket: ${parseErr.message || parseErr}`)
                }
            }

            ws.onerror = (errEvent: any) => {
                log(`Erro no WebSocket: ${errEvent.message || "Erro desconhecido"}`)
                cleanup()
                reject(new Error(`WebSocket erro: ${errEvent.message || "desconhecido"}. Logs: ${logs.join(" | ")}`))
            }

            ws.onclose = (closeEvent) => {
                log(`Conexão fechada. Code: ${closeEvent.code}, Reason: ${closeEvent.reason}`)
                cleanup()
                if (audioChunks.length > 0) {
                    resolve()
                } else {
                    reject(new Error(`WebSocket fechado sem áudio. Code: ${closeEvent.code}. Logs: ${logs.join(" | ")}`))
                }
            }
        })

        if (audioChunks.length === 0) {
            throw new Error(`Nenhum chunk de áudio foi recebido. Logs: ${logs.join(" | ")}`)
        }

        log(`Combinando ${audioChunks.length} chunks de áudio...`)
        const combined = combineBase64AudioChunks(audioChunks)
        log(`Sucesso! Áudio combinado com ${combined.length} bytes base64.`)

        return new Response(JSON.stringify({
            audioContent: combined,
            mimeType: detectedMime,
            debugLogs: logs
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })

    } catch (error: any) {
        log(`Erro final capturado: ${error.message || String(error)}`)
        return new Response(JSON.stringify({
            error: error.message || String(error),
            debugLogs: logs
        }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
    }
})
