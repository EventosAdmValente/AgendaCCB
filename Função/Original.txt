import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID")
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
}

serve(async (req) => {
    // 0. Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error("Missing Supabase environment variables.")
        }

        console.log("[Daily Notifications] ONESIGNAL_APP_ID exists:", !!ONESIGNAL_APP_ID)
        console.log("[Daily Notifications] ONESIGNAL_REST_API_KEY exists:", !!ONESIGNAL_REST_API_KEY)

        if (ONESIGNAL_REST_API_KEY) {
            console.log(`[Daily Notifications] Key check: starts with ${ONESIGNAL_REST_API_KEY.substring(0, 15)}... and ends with ...${ONESIGNAL_REST_API_KEY.substring(ONESIGNAL_REST_API_KEY.length - 10)}`);
            console.log(`[Daily Notifications] Key length: ${ONESIGNAL_REST_API_KEY.length}`);
        }

        if (!ONESIGNAL_REST_API_KEY) {
            throw new Error("ONESIGNAL_REST_API_KEY is missing!")
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        console.log("[Daily Notifications] Cliente Supabase criado.")

        // TESTE RÁPIDO: Verificar se a chave do OneSignal é aceita pelo servidor deles
        console.log("[Daily Notifications] Testando autenticação com OneSignal...");
        const authTest = await fetch(`https://onesignal.com/api/v1/apps/${ONESIGNAL_APP_ID}`, {
            method: "GET",
            headers: {
                "Authorization": `Basic ${ONESIGNAL_REST_API_KEY}`
            }
        });

        const authResult = await authTest.json();
        console.log("[Daily Notifications] Status do teste de Auth:", authTest.status);
        if (authTest.status === 401) {
            console.error("[Daily Notifications] ERRO 401: A chave REST API Key não foi aceita pelo OneSignal.");
            console.error("[Daily Notifications] Resposta do OneSignal:", JSON.stringify(authResult));
            throw new Error("Falha na autenticação com OneSignal (401). Verifique se a REST API Key está correta.");
        }
        console.log("[Daily Notifications] Autenticação OneSignal OK!");

        // 1. Obter data de hoje no fuso horário de Brasília (America/Sao_Paulo)
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const today = formatter.format(now);
        console.log(`[Daily Notifications] Verificando eventos para: ${today} (Fuso: America/Sao_Paulo)`)

        // 2. Buscar eventos de hoje
        console.log("[Daily Notifications] Buscando eventos...");
        const { data: events, error: eventsError } = await supabase
            .from('agenda')
            .select('time, location_id, type_id')
            .eq('date', today)

        if (eventsError) {
            console.error("[Daily Notifications] Erro ao buscar agenda:", eventsError);
            throw eventsError;
        }

        console.log(`[Daily Notifications] Eventos encontrados: ${events?.length || 0}`);

        if (!events || events.length === 0) {
            return new Response(JSON.stringify({ message: "Nenhum evento para hoje." }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            })
        }

        // Buscar nomes de tipos e localidades para a mensagem
        console.log("[Daily Notifications] Buscando tipos e localidades...");
        const [{ data: types, error: typesErr }, { data: locations, error: locsErr }] = await Promise.all([
            supabase.from('types').select('id, name'),
            supabase.from('locations').select('id, localidade')
        ])

        if (typesErr) console.error("[Daily Notifications] Erro tipos:", typesErr);
        if (locsErr) console.error("[Daily Notifications] Erro localidades:", locsErr);

        const typeMap = Object.fromEntries(types?.map(t => [t.id, t.name]) || [])
        const locMap = Object.fromEntries(locations?.map(l => [l.id, l.localidade]) || [])

        // 3. Verificar se é uma chamada de teste para um usuário específico
        let userIds: string[] = []
        let isTest = false

        try {
            const body = await req.json()
            if (body.user_id) {
                console.log(`[Daily Notifications] Chamada de TESTE para usuário: ${body.user_id}`)
                userIds = [body.user_id]
                isTest = true
            }
        } catch (e) {
            // Ignora erro se não houver body (chamada via GET/Cron)
        }

        if (!isTest) {
            // 3. Obter hora atual no fuso de Brasília
            const currentHour = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                hour12: false
            }).format(now);
            const currentTime = `${currentHour}:00`;
            console.log(`[Daily Notifications] Hora atual (Brasília): ${currentTime}`);

            // 4. Buscar usuários inscritos, ativos E com horário preferido = hora atual
            console.log("[Daily Notifications] Buscando inscrições para o horário atual...");
            const { data: subs, error: subsError } = await supabase
                .from('push_subscriptions')
                .select('user_id')
                .eq('active', true)
                .eq('preferred_time', currentTime)

            if (subsError) {
                console.error("[Daily Notifications] Erro ao buscar inscrições:", subsError);
                throw subsError;
            }

            console.log(`[Daily Notifications] Inscrições encontradas para ${currentTime}: ${subs?.length || 0}`);

            if (!subs || subs.length === 0) {
                return new Response(JSON.stringify({
                    message: `Nenhum usuário inscrito para o horário ${currentTime}.`,
                    currentTime: currentTime,
                    eventsToday: events.length
                }), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                })
            }
            userIds = subs.map((s: any) => s.user_id)
        }

        // 5. Montar sumário dos eventos
        const eventSummary = events
            .map(e => `${e.time} - ${typeMap[e.type_id] || 'Evento'} em ${locMap[e.location_id] || 'Local'}`)
            .join('\n')

        console.log(`[Daily Notifications] Enviando para ${userIds.length} usuários via OneSignal...`);

        // 6. Enviar via OneSignal
        const notification = {
            app_id: ONESIGNAL_APP_ID,
            contents: {
                en: `You have ${events.length} events today:\n${eventSummary}`,
                pt: `Você tem ${events.length} eventos hoje:\n${eventSummary}`
            },
            headings: {
                en: "Agenda do Dia",
                pt: "Agenda do Dia"
            },
            include_external_user_ids: userIds,
            url: "https://eventosadmvalente.github.io/AgendaCCB/"
        }

        console.log("[Daily Notifications] Enviando payload OneSignal:", JSON.stringify(notification));
        console.log("[Daily Notifications] Authorization Header check: Basic " + ONESIGNAL_REST_API_KEY?.substring(0, 5) + "...");

        const response = await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": `Basic ${ONESIGNAL_REST_API_KEY}`
            },
            body: JSON.stringify(notification)
        })

        const result = await response.json()
        console.log("[Daily Notifications] OneSignal Response Status:", response.status);
        console.log("[Daily Notifications] OneSignal Response Body:", JSON.stringify(result));

        if (response.status >= 400) {
            console.error("[Daily Notifications] Erro OneSignal detalhado:", result);
            throw new Error(`OneSignal Error: ${response.status} - ${JSON.stringify(result)}`);
        }

        return new Response(JSON.stringify({ message: "Notificações processadas", result }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
        })

    } catch (error: any) {
        console.error("[Daily Notifications] Erro CRÍTICO capturado:", error)
        return new Response(JSON.stringify({
            error: error.message || String(error),
            stack: error.stack
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500
        })
    }
})
