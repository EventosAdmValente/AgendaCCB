import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

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
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error("Credenciais do Supabase não configuradas no ambiente.")
        }

        const { query, history } = await req.json()

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return new Response(JSON.stringify({ error: "Query vazia" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

        // 1. Normaliza a pergunta para busca em cache único
        const queryLimpa = query.toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
            .replace(/\s+/g, " ")
            .trim()

        console.log(`[Gemini Proxy] Pergunta normalizada: "${queryLimpa}"`)

        // 2. Consulta no cache (Aprendizado Prévio)
        const { data: cached, error: cacheErr } = await supabase
            .from('pesquisas_voz_aprendizado')
            .select('filtros_resolvidos, resposta_voz, frequencia')
            .eq('pergunta_normalizada', queryLimpa)
            .maybeSingle()

        if (cached) {
            console.log(`[Gemini Proxy] Hit de cache/aprendizado encontrado! Resposta: "${cached.resposta_voz}"`)
            // Incrementa frequência de forma assíncrona (background)
            supabase
                .from('pesquisas_voz_aprendizado')
                .update({ 
                    frequencia: (cached.frequencia || 1) + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('pergunta_normalizada', queryLimpa)
                .then(({ error }) => {
                    if (error) console.error("[Gemini Proxy] Erro ao incrementar frequência:", error)
                })

            return new Response(JSON.stringify({
                responseText: cached.resposta_voz,
                filterAction: cached.filtros_resolvidos
            }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        // 3. Se não houver cache, roda a IA. Primeiro, obtém as entidades do banco
        console.log("[Gemini Proxy] Cache miss. Buscando entidades de referência...")
        const [typesRes, locationsRes, attendantsRes] = await Promise.all([
            supabase.from('types').select('id, name, sigla'),
            supabase.from('locations').select('id, localidade, cidade, setor, adm'),
            supabase.from('attendants').select('id, name')
        ])

        const todayStr = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date())

        // FASE 1: Gemini extrai os critérios / filtros
        const systemPromptFase1 = `Você é o assistente de voz da Agenda CCB, um sistema de gestão de eventos da Congregação Cristã no Brasil.
Sua missão na FASE 1 é ler a pergunta do usuário e mapear os IDs das entidades correspondentes.

A data de hoje é: ${todayStr}

DADOS DISPONÍVEIS NO BANCO (Use estritamente estes IDs):
- Tipos de eventos: ${JSON.stringify(typesRes.data || [])}
- Localidades: ${JSON.stringify((locationsRes.data || []).map(l => ({ id: l.id, localidade: l.localidade, cidade: l.cidade, setor: l.setor, adm: l.adm })))}
- Atendentes: ${JSON.stringify(attendantsRes.data || [])}

INSTRUÇÕES:
1. Interprete a pergunta do usuário e retorne os filtros correspondentes.
2. Corrija erros de transcrição fonética (ex: "santa luz" -> localidade ID correspondente a "Santaluz").
3. Para conversas sequenciais (histórico), se a pergunta atual for um acompanhamento (ex: "e em Santaluz?", "e o próximo?"), mantenha os filtros anteriores que fazem sentido, atualizando o novo critério.
4. Retorne APENAS um JSON válido.

FORMATO DO JSON DE RETORNO:
{
    "type_id": number ou null,
    "location_id": number ou null,
    "attendant_id": number ou null,
    "cidade": "nome da cidade correspondente ou null",
    "adm": "nome da ADM correspondente ou null",
    "setor": "nome do setor correspondente ou null",
    "dateStart": "YYYY-MM-DD ou null",
    "dateEnd": "YYYY-MM-DD ou null",
    "tense": "ativos ou inativos ou todos",
    "periodLabel": "rótulo amigável (ex: 'Esta Semana', 'Janeiro de 2026', 'Hoje') ou null"
}

REGRAS:
- "tense" DEVE ser "inativos" se a pergunta for no passado ("qual foi", "quem atendeu o último", "quantos participaram da anterior") ou "ativos" se for futuro/agendado. Use "todos" apenas em ausência de tempo claro.`

        const historyTurns = Array.isArray(history) && history.length > 0 ? history : []
        const currentTurn = {
            role: 'user',
            parts: [{ text: `Pergunta do usuário: "${query}"` }]
        }
        const contentsFase1 = historyTurns.length > 0 ? [...historyTurns, currentTurn] : [currentTurn]

        const payloadFase1 = {
            contents: contentsFase1,
            systemInstruction: { parts: [{ text: systemPromptFase1 }] },
            generationConfig: { temperature: 0, responseMimeType: "application/json" }
        }

        let data1 = null;
        let lastErr1 = null;
        const modelsFase1 = ['gemini-flash-lite-latest'];
        
        for (const model of modelsFase1) {
            try {
                let res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_AI_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadFase1)
                });
                
                if (res.status === 503 || res.status === 429) {
                    await new Promise(r => setTimeout(r, 1500)); // wait 1.5s
                    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_AI_KEY}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payloadFase1)
                    });
                }
                
                if (!res.ok) throw new Error(`Erro ${model}: ${await res.text()}`);
                data1 = await res.json();
                break; // Sucesso, sai do loop
            } catch (err) {
                lastErr1 = err;
                console.warn(`[Gemini Proxy] Falha com ${model} na Fase 1:`, err);
            }
        }

        if (!data1) throw new Error(`Erro Gemini Fase 1 após fallback: ${lastErr1}`);

        const text1 = data1?.candidates?.[0]?.content?.parts?.[0]?.text
        if (!text1) throw new Error("Retorno vazio do Gemini na Fase 1")

        const cleanJson = text1.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
        const parsedCriteria = JSON.parse(cleanJson)

        console.log("[Gemini Proxy] Filtros extraídos:", JSON.stringify(parsedCriteria))

        // FASE 2: Consultar dados no banco de dados e formular a resposta
        let queryBuilder = supabase
            .from('agenda')
            .select('id, date, time, location_id, type_id, attendant_id, attendant2_id, irmaos, irmas')

        if (parsedCriteria.dateStart) queryBuilder = queryBuilder.gte('date', parsedCriteria.dateStart)
        if (parsedCriteria.dateEnd) queryBuilder = queryBuilder.lte('date', parsedCriteria.dateEnd)

        if (parsedCriteria.tense === 'ativos') {
            queryBuilder = queryBuilder.gte('date', todayStr)
        } else if (parsedCriteria.tense === 'inativos') {
            queryBuilder = queryBuilder.lt('date', todayStr)
        }

        if (parsedCriteria.type_id) {
            queryBuilder = queryBuilder.eq('type_id', parsedCriteria.type_id)
        }
        if (parsedCriteria.location_id) {
            queryBuilder = queryBuilder.eq('location_id', parsedCriteria.location_id)
        }
        if (parsedCriteria.attendant_id) {
            queryBuilder = queryBuilder.or(`attendant_id.eq.${parsedCriteria.attendant_id},attendant2_id.eq.${parsedCriteria.attendant_id}`)
        }

        // Critérios geográficos se localidade direta não foi identificada
        if (!parsedCriteria.location_id && (parsedCriteria.cidade || parsedCriteria.setor || parsedCriteria.adm)) {
            let locsQuery = supabase.from('locations').select('id')
            if (parsedCriteria.cidade) locsQuery = locsQuery.ilike('cidade', parsedCriteria.cidade)
            if (parsedCriteria.setor) locsQuery = locsQuery.ilike('setor', parsedCriteria.setor)
            if (parsedCriteria.adm) locsQuery = locsQuery.ilike('adm', parsedCriteria.adm)
            
            const { data: matchedLocs } = await locsQuery
            if (matchedLocs && matchedLocs.length > 0) {
                const locIds = matchedLocs.map((l: any) => l.id)
                queryBuilder = queryBuilder.in('location_id', locIds)
            } else {
                queryBuilder = queryBuilder.eq('location_id', -1) // Força vazio
            }
        }

        const { data: eventsList, error: queryErr } = await queryBuilder
        if (queryErr) throw queryErr

        console.log(`[Gemini Proxy] Query no banco retornou ${eventsList?.length || 0} eventos.`)

        // Formata os eventos em linguagem legível para a IA Fase 2 formular a resposta
        const eventsFormatted = (eventsList || []).map(e => {
            const typeName = typesRes.data?.find(t => t.id === e.type_id)?.name || 'Evento'
            const loc = locationsRes.data?.find(l => l.id === e.location_id)
            const locName = loc ? `${loc.localidade} (${loc.cidade})` : 'Local desconhecido'
            const attName = attendantsRes.data?.find(a => a.id === e.attendant_id)?.name || ''
            const att2Name = attendantsRes.data?.find(a => a.id === e.attendant2_id)?.name || ''
            
            return {
                data: e.date,
                hora: e.time ? e.time.substring(0, 5) : '',
                tipo: typeName,
                localidade: locName,
                atendente: attName + (att2Name ? ` e ${att2Name}` : ''),
                irmaos: e.irmaos || 0,
                irmas: e.irmas || 0
            }
        })

        // Ordena por data (futuros crescente, passados decrescente)
        if (parsedCriteria.tense === 'inativos') {
            eventsFormatted.sort((a, b) => b.data.localeCompare(a.data))
        } else {
            eventsFormatted.sort((a, b) => a.data.localeCompare(b.data))
        }

        const systemPromptFase2 = `Você é o assistente de voz da Agenda CCB.
Sua missão na FASE 2 é formular uma resposta natural em português do Brasil (para leitura em voz alta por síntese de voz) baseando-se na pergunta do usuário e nos dados REAIS obtidos do banco de dados.

REGRAS:
1. Responda de forma direta, clara e fluida por extenso.
2. Escreva números e abreviações POR EXTENSO (ex: "São Paulo" em vez de "SP", "Administração" em vez de "ADM", "Conceição do Coité" em vez de "C. do Coité").
3. Se houver informações de batismo (irmãos/irmãs batizados) ou Santa Ceia (participantes), mencione-os de forma natural.
4. Responda ESTRITAMENTE baseando-se nos dados fornecidos abaixo. Se a lista estiver vazia, diga educadamente que não encontrou nenhum evento agendado ou realizado com esses critérios.

Pergunta do usuário: "${query}"
Filtros aplicados: ${JSON.stringify(parsedCriteria)}
Dados reais retornados do banco:
${JSON.stringify(eventsFormatted.slice(0, 15))} (Total de eventos encontrados: ${eventsFormatted.length})`

        const payloadFase2 = {
            contents: [{ role: 'user', parts: [{ text: "Gere a resposta por voz com base nos dados fornecidos." }] }],
            systemInstruction: { parts: [{ text: systemPromptFase2 }] },
            generationConfig: { temperature: 0.2 }
        };

        let data2 = null;
        let lastErr2 = null;
        const modelsFase2 = ['gemini-flash-lite-latest'];
        
        for (const model of modelsFase2) {
            try {
                let res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_AI_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadFase2)
                });
                
                if (res.status === 503 || res.status === 429) {
                    await new Promise(r => setTimeout(r, 1500));
                    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_AI_KEY}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payloadFase2)
                    });
                }

                if (!res.ok) throw new Error(`Erro ${model}: ${await res.text()}`);
                data2 = await res.json();
                break;
            } catch (err) {
                lastErr2 = err;
                console.warn(`[Gemini Proxy] Falha com ${model} na Fase 2:`, err);
            }
        }

        if (!data2) throw new Error(`Erro Gemini Fase 2 após fallback: ${lastErr2}`);

        let responseText = data2?.candidates?.[0]?.content?.parts?.[0]?.text
        if (!responseText) throw new Error("Retorno vazio do Gemini na Fase 2")

        responseText = responseText.trim()

        const filterAction = {
            type_id: parsedCriteria.type_id,
            location_id: parsedCriteria.location_id,
            cidade: parsedCriteria.cidade,
            adm: parsedCriteria.adm,
            setor: parsedCriteria.setor,
            dateStart: parsedCriteria.dateStart,
            dateEnd: parsedCriteria.dateEnd,
            tense: parsedCriteria.tense,
            periodLabel: parsedCriteria.periodLabel
        }

        // 4. Salva no banco de dados (Aprendizado Centralizado)
        const { error: insertErr } = await supabase
            .from('pesquisas_voz_aprendizado')
            .insert({
                pergunta_normalizada: queryLimpa,
                pergunta_original: query,
                filtros_resolvidos: filterAction,
                resposta_voz: responseText,
                frequencia: 1
            })

        if (insertErr) {
            console.error("[Gemini Proxy] Erro ao gravar aprendizado no banco (pode ser duplicidade concorrente):", insertErr)
        } else {
            console.log(`[Gemini Proxy] Pergunta "${queryLimpa}" aprendida com sucesso no banco de dados!`)
        }

        return new Response(JSON.stringify({ responseText, filterAction, debug_insert_error: insertErr }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })

    } catch (error: any) {
        console.error("[Gemini Proxy] Erro Geral:", error)
        
        // Se após todos os fallbacks ainda falhar, retornamos uma mensagem amigável de voz
        const isUnavailable = error.message?.includes("503") || error.message?.includes("UNAVAILABLE") || error.message?.includes("429");
        
        if (isUnavailable) {
            return new Response(JSON.stringify({
                responseText: "No momento o assistente está recebendo muitos pedidos e está sobrecarregado. Por favor, aguarde alguns segundos e tente novamente.",
                filterAction: null
            }), {
                status: 200, // Retornamos 200 para a UI falar o texto amigavelmente
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        return new Response(JSON.stringify({
            error: error.message || String(error)
        }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        })
    }
})
