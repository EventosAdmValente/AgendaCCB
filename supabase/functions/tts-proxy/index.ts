import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

// Sistema de dupla chave: gratuita primeiro, paga como fallback
const GOOGLE_AI_KEY_FREE   = Deno.env.get("GOOGLE_AI_KEY_FREE")
const GOOGLE_AI_KEY_PAID   = Deno.env.get("GOOGLE_AI_KEY_PAID")
const GOOGLE_AI_KEY_LEGACY = Deno.env.get("GOOGLE_AI_KEY") // compatibilidade

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
}

// Resolve a chave ativa na ordem de prioridade
function resolveKeys(): string[] {
    const keys: string[] = []
    if (GOOGLE_AI_KEY_FREE)  keys.push(GOOGLE_AI_KEY_FREE)
    if (GOOGLE_AI_KEY_PAID)  keys.push(GOOGLE_AI_KEY_PAID)
    if (GOOGLE_AI_KEY_LEGACY && !GOOGLE_AI_KEY_FREE && !GOOGLE_AI_KEY_PAID) keys.push(GOOGLE_AI_KEY_LEGACY)
    return keys
}

// Classe auxiliar para converter eventos de WebSocket em um AsyncIterable
class MessageQueue<T> {
    private queue: T[] = []
    private resolvers: ((value: IteratorResult<T>) => void)[] = []
    private done = false
    private error: Error | null = null

    push(value: T) {
        if (this.done) return
        if (this.resolvers.length > 0) {
            const resolve = this.resolvers.shift()!
            resolve({ value, done: false })
        } else {
            this.queue.push(value)
        }
    }

    pushError(err: Error) {
        this.error = err
        this.close()
    }

    close() {
        this.done = true
        while (this.resolvers.length > 0) {
            const resolve = this.resolvers.shift()!
            if (this.error) {
                resolve(Promise.reject(this.error) as any)
            } else {
                resolve({ value: undefined as any, done: true })
            }
        }
    }

    async next(): Promise<IteratorResult<T>> {
        if (this.queue.length > 0) {
            return { value: this.queue.shift()!, done: false }
        }
        if (this.done) {
            if (this.error) throw this.error
            return { value: undefined as any, done: true }
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
            this.resolvers.push((res) => {
                if (this.error) reject(this.error)
                else resolve(res)
            })
        })
    }

    [Symbol.asyncIterator]() {
        return this
    }
}

// Retorna um gerador assíncrono que transmite chunks de áudio em tempo real via WebSocket
async function* streamAudioWithKey(key: string, safeText: string, selectedVoice: string): AsyncGenerator<Uint8Array, void, unknown> {
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`
    
    let ws: WebSocket
    try {
        ws = new WebSocket(geminiUrl)
    } catch (err: any) {
        throw new Error(`Erro ao instanciar WebSocket: ${err.message}`)
    }

    const queue = new MessageQueue<Uint8Array>()
    const encoder = new TextEncoder()
    let hasData = false

    const timeoutId = setTimeout(() => {
        try { ws.close() } catch(_) {}
        queue.pushError(new Error("Timeout aguardando áudio do Gemini"))
    }, 20000)

    ws.onopen = () => {
        const setupMessage = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-latest",
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    temperature: 0,
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } }
                },
                systemInstruction: { parts: [{ text: "Você é um leitor de texto em voz alta. Leia o texto fornecido em português, de forma natural e exatamente como escrito. NÃO adicione comentários." }] }
            }
        }
        const contentMessage = {
            clientContent: {
                turns: [{ role: "user", parts: [{ text: `Leia em voz alta:\n\n${safeText}` }] }],
                turnComplete: true
            }
        }
        try {
            ws.send(JSON.stringify(setupMessage))
            ws.send(JSON.stringify(contentMessage))
        } catch(e: any) {
            clearTimeout(timeoutId)
            queue.pushError(new Error(`Erro ao enviar mensagens no WS: ${e.message}`))
        }
    }

    ws.onmessage = async (event) => {
        try {
            let textData = ""
            if (event.data instanceof Blob) textData = await event.data.text()
            else if (typeof event.data === "string") textData = event.data
            else textData = new TextDecoder().decode(new Uint8Array(event.data))

            const response = JSON.parse(textData)

            if (response.error) {
                clearTimeout(timeoutId)
                queue.pushError(new Error(`Erro API Gemini: ${response.error.message || JSON.stringify(response.error)}`))
                return
            }

            const modelTurn = response.serverContent?.modelTurn
            if (modelTurn?.parts) {
                for (const part of modelTurn.parts) {
                    if (part.inlineData?.data) {
                        hasData = true
                        queue.push(encoder.encode(part.inlineData.data + "\n"))
                    }
                }
            }

            if (response.serverContent?.turnComplete) {
                clearTimeout(timeoutId)
                if (hasData) {
                    queue.close()
                } else {
                    queue.pushError(new Error("Turno completo mas sem dados de áudio."))
                }
                try { ws.close() } catch(_) {}
            }
        } catch (parseErr: any) {
            console.error("[TTS WS Message Error]", parseErr)
        }
    }

    ws.onerror = (errEvent: any) => {
        clearTimeout(timeoutId)
        queue.pushError(new Error(`Erro na conexão WebSocket do Gemini.`))
    }

    ws.onclose = (ev) => {
        clearTimeout(timeoutId)
        if (hasData) {
            queue.close()
        } else {
            queue.pushError(new Error(`Conexão fechada prematuramente pelo Gemini (code=${ev.code}).`))
        }
    }

    try {
        for await (const chunk of queue) {
            yield chunk
        }
    } finally {
        clearTimeout(timeoutId)
        try { if (ws.readyState <= 1) ws.close() } catch(_) {}
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const keys = resolveKeys()
        if (keys.length === 0) throw new Error("Nenhuma GOOGLE_AI_KEY configurada.")

        const { text, voice } = await req.json()
        if (!text?.trim()) {
            return new Response(JSON.stringify({ error: "Texto vazio" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        const safeText = text.slice(0, 4000)
        const selectedVoice = voice || 'Puck'

        console.log(`[TTS Stream] Iniciando. Voz: ${selectedVoice}, Texto: ${safeText.substring(0, 30)}...`)

        // Tenta obter o stream de áudio
        let activeGenerator: AsyncGenerator<Uint8Array, void, unknown> | null = null
        let firstChunk: Uint8Array | null = null
        let lastErr: Error | null = null

        for (const key of keys) {
            try {
                const gen = streamAudioWithKey(key, safeText, selectedVoice)
                // Valida a chave puxando o primeiro chunk de áudio
                const next = await gen.next()
                if (!next.done && next.value) {
                    firstChunk = next.value
                    activeGenerator = gen
                    console.log(`[TTS Stream] Sucesso ao iniciar streaming com chave (${keys.indexOf(key) === 0 ? 'free/legacy' : 'paid'}).`)
                    break
                }
            } catch (err: any) {
                console.warn(`[TTS Stream] Falha ao iniciar com chave ${keys.indexOf(key) + 1}: ${err.message}`)
                lastErr = err
            }
        }

        if (!activeGenerator || !firstChunk) {
            console.error("[TTS Stream] Todas as chaves falharam ao iniciar streaming:", lastErr?.message)
            return new Response(JSON.stringify({ error: "TTS indisponível: " + lastErr?.message }), {
                status: 503,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        // Retorna o stream real para o cliente HTTP
        const stream = new ReadableStream({
            async start(controller) {
                controller.enqueue(firstChunk!)
                try {
                    for await (const chunk of activeGenerator!) {
                        controller.enqueue(chunk)
                    }
                } catch (streamErr) {
                    console.error("[TTS Stream] Erro durante a transmissão do stream:", streamErr)
                } finally {
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

