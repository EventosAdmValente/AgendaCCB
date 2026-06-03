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

        const { query, context } = await req.json()

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return new Response(JSON.stringify({ error: "Query vazia" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        // Monta o prompt do sistema com contexto dos dados disponíveis
        const todayStr = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date())

        const systemPrompt = `Você é o assistente de voz da Agenda CCB, um sistema de gestão de eventos da Congregação Cristã no Brasil.

A data de hoje é: ${todayStr}

DADOS DISPONÍVEIS NO SISTEMA:
- Tipos de eventos: ${(context?.types || []).join(', ') || 'nenhum'}
- Localidades (casas de oração): ${(context?.locations || []).slice(0, 80).join(', ') || 'nenhuma'}
- Atendentes (anciãos/diáconos): ${(context?.attendants || []).slice(0, 80).join(', ') || 'nenhum'}
- ADMs disponíveis: ${(context?.adms || []).join(', ') || 'nenhuma'}
- Setores disponíveis: ${(context?.setores || []).join(', ') || 'nenhum'}
- Cidades disponíveis: ${(context?.cidades || []).join(', ') || 'nenhuma'}

INSTRUÇÕES:
1. Interprete a pergunta do usuário e identifique os filtros de busca
2. Corrija possíveis erros de transcrição de voz (ex: "marco" pode ser "marcos", "santa luz" pode ser "santaluz")
3. Tente corresponder nomes parciais ou aproximados com os dados disponíveis
4. Retorne APENAS um JSON válido (sem markdown, sem explicação)

FORMATO DO JSON DE RESPOSTA:
{
    "type": "nome exato do tipo de evento ou null",
    "location": "nome exato da localidade ou null",
    "cidade": "nome da cidade ou null",
    "adm": "nome da ADM ou null",
    "setor": "nome do setor ou null",
    "attendant": "nome do atendente ou null",
    "dateStart": "YYYY-MM-DD ou null",
    "dateEnd": "YYYY-MM-DD ou null",
    "tense": "ativos ou inativos ou todos",
    "periodLabel": "rótulo do período em português (ex: 'Janeiro de 2026', 'Hoje', 'Esta Semana') ou null",
    "responseText": "resposta natural em português para ser lida em voz alta - NÃO use abreviações, escreva por extenso"
}

REGRAS IMPORTANTES:
- "tense" deve ser "inativos" para perguntas sobre o passado, "ativos" para futuro, "todos" se não especificado
- Use os nomes EXATAMENTE como estão nos dados disponíveis
- Se não conseguir identificar um filtro, use null
- O "responseText" será gerado posteriormente pelo sistema, então pode ser uma frase genérica como "Buscando resultados..."
- Para datas, considere "esse mês", "mês que vem", "este ano", "hoje", "amanhã", "semana que vem", "último mês" etc.
- Para perguntas sobre "último batismo", "último evento", use tense "inativos"
- Se o usuário perguntar "quantos", identifique que é uma consulta de quantidade`

        const payload = {
            contents: [{
                parts: [{
                    text: `Pergunta do usuário: "${query}"`
                }]
            }],
            systemInstruction: {
                parts: [{
                    text: systemPrompt
                }]
            },
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 300,
                responseMimeType: "application/json"
            }
        }

        console.log(`[Gemini Proxy] Interpretando: "${query}"`)

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        )

        if (!response.ok) {
            const errBody = await response.text()
            console.error(`[Gemini Proxy] Erro Gemini (${response.status}):`, errBody)
            return new Response(JSON.stringify({
                error: `Gemini retornou ${response.status}`,
                details: errBody
            }), {
                status: response.status,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        const data = await response.json()

        // Extrai o texto gerado pelo Gemini
        const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text
        if (!generatedText) {
            console.error("[Gemini Proxy] Resposta vazia do Gemini:", JSON.stringify(data))
            return new Response(JSON.stringify({ error: "Gemini retornou resposta vazia" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        // Parse do JSON retornado pelo Gemini
        let parsedResult
        try {
            // Limpa possíveis artefatos de markdown
            const cleanJson = generatedText
                .replace(/```json\s*/g, '')
                .replace(/```\s*/g, '')
                .trim()
            parsedResult = JSON.parse(cleanJson)
        } catch (parseErr) {
            console.error("[Gemini Proxy] Erro ao parsear JSON do Gemini:", generatedText)
            return new Response(JSON.stringify({
                error: "Gemini retornou JSON inválido",
                raw: generatedText
            }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        console.log(`[Gemini Proxy] Resultado:`, JSON.stringify(parsedResult))

        return new Response(JSON.stringify(parsedResult), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })

    } catch (error: any) {
        console.error("[Gemini Proxy] Erro:", error)
        return new Response(JSON.stringify({
            error: error.message || String(error)
        }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
    }
})
