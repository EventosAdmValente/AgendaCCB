import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY")

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        if (!GOOGLE_AI_KEY) {
            throw new Error("GOOGLE_AI_KEY não configurada.")
        }

        const { text, voice } = await req.json()

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return new Response(JSON.stringify({ error: "Texto vazio" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        // Limita o texto a 2000 caracteres
        const safeText = text.slice(0, 2000)

        // Vozes válidas: Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr
        const selectedVoice = voice || 'Puck'

        // Formato correto para gemini-2.5-flash-preview-tts
        const payload = {
            contents: [{
                parts: [{
                    text: safeText
                }]
            }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: selectedVoice
                        }
                    }
                }
            }
        }

        const keyPrefix = GOOGLE_AI_KEY ? GOOGLE_AI_KEY.substring(0, 10) + '...' : 'VAZIA'
        console.log(`[TTS] gemini-2.5-flash-preview-tts | voz=${selectedVoice} | chars=${safeText.length} | key=${keyPrefix}`)

        const controller = new AbortController()
        const fetchTimeout = setTimeout(() => controller.abort(), 25000)

        let response: Response
        try {
            response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GOOGLE_AI_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                }
            )
        } finally {
            clearTimeout(fetchTimeout)
        }

        if (!response.ok) {
            const errBody = await response.text()
            console.error(`[TTS] Erro ${response.status}:`, errBody)
            return new Response(JSON.stringify({
                error: `Gemini TTS retornou ${response.status}`,
                details: errBody
            }), {
                status: response.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        const data = await response.json()
        const candidates = data?.candidates || []
        let audioBase64 = ""
        let detectedMime = "audio/L16;codec=pcm;rate=24000"

        if (candidates.length > 0) {
            const parts = candidates[0]?.content?.parts || []
            for (const part of parts) {
                if (part.inlineData) {
                    audioBase64 = part.inlineData.data || ""
                    detectedMime = part.inlineData.mimeType || detectedMime
                    break
                }
            }
        }

        if (!audioBase64) {
            const finishReason = candidates[0]?.finishReason || 'unknown'
            console.error(`[TTS] Sem áudio. finishReason=${finishReason}`)
            throw new Error(`Áudio não gerado (finishReason=${finishReason})`)
        }

        console.log(`[TTS] Sucesso! ${audioBase64.length} chars base64, mime=${detectedMime}`)

        return new Response(JSON.stringify({
            audioContent: audioBase64,
            mimeType: detectedMime
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })

    } catch (error: any) {
        console.error("[TTS] Erro:", error)
        return new Response(JSON.stringify({
            error: error.message || String(error)
        }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
    }
})
