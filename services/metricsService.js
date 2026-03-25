function safeJsonParse(str) {
  try {
    return typeof str === "string" ? JSON.parse(str) : str;
  } catch {
    return null;
  }
}

function ensureMetricsDefaults(facts) {
  if (!facts || typeof facts !== "object") return;

  if (!facts.metrics || typeof facts.metrics !== "object") {
    facts.metrics = {};
  }

  if (typeof facts.metrics.objections_total !== "number") {
    facts.metrics.objections_total = 0;
  }

  if (
    !facts.metrics.objections_by_type ||
    typeof facts.metrics.objections_by_type !== "object"
  ) {
    facts.metrics.objections_by_type = {};
  }

  const types = ["price", "trust", "time", "other"];

  for (const t of types) {
    if (typeof facts.metrics.objections_by_type[t] !== "number") {
      facts.metrics.objections_by_type[t] = 0;
    }
  }

  if (
    facts.metrics.last_objection !== null &&
    typeof facts.metrics.last_objection !== "object"
  ) {
    facts.metrics.last_objection = null;
  }

  if (!facts.metrics.stage_flow || typeof facts.metrics.stage_flow !== "object") {
    facts.metrics.stage_flow = {
      last_transition: null,
      counts: {},
    };
  }

  if (
    facts.metrics.stage_flow.last_transition !== null &&
    typeof facts.metrics.stage_flow.last_transition !== "object"
  ) {
    facts.metrics.stage_flow.last_transition = null;
  }

  if (
    !facts.metrics.stage_flow.counts ||
    typeof facts.metrics.stage_flow.counts !== "object"
  ) {
    facts.metrics.stage_flow.counts = {};
  }
}

function bumpObjection(facts, payload = {}) {
  if (!facts || typeof facts !== "object") return;

  ensureMetricsDefaults(facts);
  facts._dirty = true;

  const type = payload.type || "other";

  facts.metrics.objections_total += 1;

  if (typeof facts.metrics.objections_by_type[type] !== "number") {
    facts.metrics.objections_by_type[type] = 0;
  }

  facts.metrics.objections_by_type[type] += 1;

  facts.metrics.last_objection = {
    type,
    stage: payload.stage || null,
    pendingField: payload.pendingField || null,
    inboundId: payload.inboundId || null,
    at: new Date().toISOString(),
  };
}

function getStageFlowFromFacts(facts) {
  if (!facts || typeof facts !== "object") return {};

  const counts = facts?.metrics?.stage_flow?.counts;
  if (!counts || typeof counts !== "object") return {};

  return counts;
}

function aggregateStageFlowFromCustomers(customers = []) {
  const aggregate = {};

  for (const c of customers) {
    const facts = c?.facts_json ? safeJsonParse(c.facts_json) : null;
    const counts = getStageFlowFromFacts(facts);

    for (const key of Object.keys(counts)) {
      aggregate[key] = (aggregate[key] || 0) + Number(counts[key] || 0);
    }
  }

  return aggregate;
}

function computeFunnelConversion(funnel = {}) {
  const result = {};
  const incomingByStage = {};
  const outgoingByStage = {};
  
  for (const transitionKey of Object.keys(funnel || {})) {
    const count = Number(funnel[transitionKey] || 0);
    const parts = String(transitionKey).split("->");
    if (parts.length !== 2) continue;

    const from = parts[0];
    const to = parts[1];

    outgoingByStage[from] = (outgoingByStage[from] || 0) + count;
    incomingByStage[to] = (incomingByStage[to] || 0) + count;
  }

  for (const transitionKey of Object.keys(funnel || {})) {
    const count = Number(funnel[transitionKey] || 0);
    const parts = String(transitionKey).split("->");
    if (parts.length !== 2) continue;

    const from = parts[0];
    const entered = incomingByStage[from] || outgoingByStage[from] || 0;
    const conversionRate = entered > 0 ? Number(((count / entered) * 100).toFixed(2)) : 0;

    result[transitionKey] = {
      count,
      conversion_rate: conversionRate,
    };
  }

  return result;
}

function computeStageDropOff(funnel = {}) {
  const incomingByStage = {};
  const outgoingByStage = {};
  const stageDropOff = {};

  for (const transitionKey of Object.keys(funnel || {})) {
    const rawValue = funnel[transitionKey];
    const count =
      rawValue && typeof rawValue === "object"
        ? Number(rawValue.count || 0)
        : Number(rawValue || 0);

    const parts = String(transitionKey).split("->");
    if (parts.length !== 2) continue;

    const from = String(parts[0] || "").trim();
    const to = String(parts[1] || "").trim();
    if (!from || !to) continue;

    outgoingByStage[from] = (outgoingByStage[from] || 0) + count;
    incomingByStage[to] = (incomingByStage[to] || 0) + count;
  }

  const stages = new Set([
    ...Object.keys(incomingByStage),
    ...Object.keys(outgoingByStage),
  ]);

  for (const stage of stages) {
    const incoming = Number(incomingByStage[stage] || 0);
    const outgoing = Number(outgoingByStage[stage] || 0);

    const entered = incoming > 0 ? incoming : outgoing;
    const progressed = outgoing;
    const dropped = Math.max(entered - progressed, 0);

    stageDropOff[stage] = {
      entered,
      progressed,
      dropped,
      drop_rate: entered > 0 ? Number(((dropped / entered) * 100).toFixed(2)) : 0,
    };
  }

  return stageDropOff;
}

function buildFunnelInsights(funnel = {}, stageDropOff = {}) {
  const insights = [];

  for (const stage of Object.keys(stageDropOff || {})) {
    const data = stageDropOff[stage] || {};
    if (Number(data.dropped || 0) > 0) {
      insights.push({
        stage,
        type: "drop_off",
        message: `A etapa ${stage} teve ${data.dropped} perda(s) no funil.`,
      });
    }
  }

  return insights;
}

function buildStageInsights(funnelConversion = {}) {
  const insights = [];

  for (const key of Object.keys(funnelConversion || {})) {
    const item = funnelConversion[key] || {};

    const entered = Number(item.entered || 0);
    const progressed = Number(item.progressed || item.advanced || 0);

    let rate = 0;

    if (typeof item.conversion_rate !== "undefined") {
      rate = Number(item.conversion_rate || 0);
    } else if (entered > 0) {
      rate = Number(((progressed / entered) * 100).toFixed(2));
    }

    let status = "ok";
    let message = `Conversão estável em ${key}.`;

    if (entered > 0 && rate === 0) {
      status = "critical";
      message = `Sem conversão em ${key}.`;
    } else if (rate < 50) {
      status = "warning";
      message = `Conversão baixa em ${key}.`;
    } else if (rate >= 80) {
      status = "great";
      message = `Conversão forte em ${key}.`;
    }

    insights.push({
      stage: key,
      conversion_rate: rate,
      status,
      message,
      entered,
      progressed,
      dropped: Number(item.dropped || item.drop_off_count || 0),
      drop_rate: Number(item.drop_rate || item.drop_off_rate || 0),
    });
  }

  return insights;
}

/* =========================
   NOVO: ALERTAS DO FUNIL
========================= */
function buildFunnelAlerts({
  funnel = {},
  stage_drop_off = {},
  comparison = null,
  stage_comparison = {},
  stage_comparison_insights = {},
  health = null,
  health_trend = "stable",
} = {}) {
  const alerts = [];

  for (const stageKey of Object.keys(stage_drop_off || {})) {
    const dropData = stage_drop_off[stageKey] || {};
    const entered = Number(dropData.entered || 0);
    const dropped = Number(dropData.dropped || 0);
    const dropRate = Number(dropData.drop_rate || 0);

    if (entered >= 2 && dropped >= 1 && dropRate >= 40) {
      alerts.push({
        type: "critical_drop",
        severity: dropRate >= 70 ? "high" : "medium",
        stage: stageKey,
        message: `Queda relevante na etapa ${stageKey}`,
        action: `Revisar fricção, objeções e fluxo da etapa ${stageKey}`,
        meta: {
          entered,
          dropped,
          drop_rate: dropRate,
        },
      });
    }
  }

  for (const stageKey of Object.keys(stage_comparison_insights || {})) {
    const insight = stage_comparison_insights[stageKey];
    const compare = stage_comparison?.[stageKey] || {};

    if (!insight || typeof insight !== "object") continue;

    if (insight.status === "worsening") {
      alerts.push({
        type: "stage_worsening",
        severity: "medium",
        stage: stageKey,
        message: insight.message || `Piora detectada na etapa ${stageKey}`,
        action: `Investigar mudanças recentes na etapa ${stageKey}`,
        meta: {
          current_conversion: Number(compare.current_conversion || 0),
          previous_conversion: Number(compare.previous_conversion || 0),
          delta: Number(compare.delta || 0),
          trend: compare.trend || "stable",
        },
      });
    }

    if (insight.status === "new_signal") {
      alerts.push({
        type: "opportunity",
        severity: "medium",
        stage: stageKey,
        message: insight.message || `Nova oportunidade detectada em ${stageKey}`,
        action: `Analisar e reforçar o que começou a funcionar em ${stageKey}`,
        meta: {
          current_conversion: Number(compare.current_conversion || 0),
          previous_conversion: Number(compare.previous_conversion || 0),
          delta: Number(compare.delta || 0),
          trend: compare.trend || "stable",
        },
      });
    }
  }

  if (comparison?.health_trend === "down" || health_trend === "down") {
    alerts.push({
      type: "health_decline",
      severity: "high",
      stage: null,
      message: "Saúde geral do funil piorou em relação ao período anterior",
      action: "Revisar gargalos principais e etapas com piora recente",
      meta: {
        current_health: comparison?.current_health ?? health ?? null,
        previous_health: comparison?.previous_health ?? null,
        health_trend: comparison?.health_trend ?? health_trend,
      },
    });
  }

  if (
    comparison?.volume_trend === "up" &&
    (comparison?.health_trend === "down" || comparison?.health_trend === "stable")
  ) {
    alerts.push({
      type: "scale_risk",
      severity: "medium",
      stage: null,
      message: "Volume subiu, mas a saúde do funil não acompanhou",
      action: "Evitar escalar tráfego antes de corrigir conversão e gargalos",
      meta: {
        current_total: comparison?.current_total ?? null,
        previous_total: comparison?.previous_total ?? null,
        delta_volume: comparison?.delta_volume ?? 0,
        health_trend: comparison?.health_trend ?? "stable",
      },
    });
  }

  const seen = new Set();
  const deduped = [];

  for (const alert of alerts) {
    const key = `${alert.type}::${alert.stage || "global"}::${alert.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(alert);
    }
  }

  const severityWeight = { high: 3, medium: 2, low: 1 };

  deduped.sort((a, b) => {
    const aw = severityWeight[a.severity] || 0;
    const bw = severityWeight[b.severity] || 0;
    return bw - aw;
  });

  return deduped;
}

  


module.exports = {
  safeJsonParse,
  ensureMetricsDefaults,
  bumpObjection,
  getStageFlowFromFacts,
  aggregateStageFlowFromCustomers,
  computeFunnelConversion,
  computeStageDropOff,
  getTopDropOffStages,
  buildFunnelInsights,
  buildStageInsights,
  buildFunnelAlerts,
  computeFunnelHealth,
};

function getTopDropOffStages(stageDropOff = {}, limit = 3) {
  return Object.entries(stageDropOff)
    .map(([stage, data]) => ({
      stage,
      drop_off_count: Number(data?.drop_off_count || 0),
      drop_off_rate: Number(data?.drop_off_rate || 0),
      entered: Number(data?.entered || 0),
      advanced: Number(data?.advanced || 0),
    }))
    .filter((item) => item.entered > 0)
    .sort((a, b) => {
      if (b.drop_off_count !== a.drop_off_count) {
        return b.drop_off_count - a.drop_off_count;
      }
      return b.drop_off_rate - a.drop_off_rate;
    })
    .slice(0, limit);
}




function computeFunnelHealth(stageInsights = []) {
  let criticalCount = 0;
  let warningCount = 0;
  let total = 0;

  for (const item of stageInsights || []) {
    if (!item) continue;

    total++;

    const rate = Number(item.conversion_rate || 0);
    const dropRate = Number(item.drop_rate || 0);

    if (rate === 0 || dropRate >= 60) {
      criticalCount++;
    } else if (rate < 60) {
      warningCount++;
    }
  }

  if (total === 0) return "unknown";

  if (criticalCount >= 2) return "critical";
  if (criticalCount >= 1 || warningCount >= 2) return "warning";

  return "healthy";
}

