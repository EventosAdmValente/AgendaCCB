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
            throw new Error("GOOGLE_AI_KEY não configurada. Use: supabase secrets set GOOGLE_AI_KEY=sua_chave")
        }

        const { text, voice } = await req.json()

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return new Response(JSON.stringify({ error: "Texto vazio" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        // Limita o texto a 3000 caracteres
        const safeText = text.slice(0, 3000)

        // Vozes válidas do Gemini: Puck, Charon, Kore, Fenrir, Aoede
        const selectedVoice = voice || 'Puck'

        const payload = {
            contents: [{
                parts: [{
                    text: safeText
                }]
            }],
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
            }
        }

        console.log(`[TTS Proxy] Sintetizando ${safeText.length} chars usando Gemini (${selectedVoice})...`)

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${GOOGLE_AI_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        )

        if (!response.ok) {
            const errBody = await response.text()
            console.error(`[TTS Proxy] Erro Gemini TTS (${response.status}):`, errBody)
            return new Response(JSON.stringify({
                error: `Gemini TTS retornou ${response.status}`,
                details: errBody
            }), {
                status: response.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        const data = await response.json()

        // Extrai o áudio inline dos parts do candidate
        const candidates = data?.candidates || []
        let audioBase64 = ""
        let detectedMime = "audio/l16;rate=24000;channels=1"

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
            console.error("[TTS Proxy] Áudio não encontrado na resposta do Gemini:", JSON.stringify(data))
            throw new Error("Áudio não gerado pela API do Gemini")
        }

        return new Response(JSON.stringify({
            audioContent: audioBase64,
            mimeType: detectedMime
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })

    } catch (error: any) {
        console.error("[TTS Proxy] Erro:", error)
        return new Response(JSON.stringify({
            error: error.message || String(error)
        }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
    }
})
