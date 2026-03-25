const express = require("express");
const router = express.Router();

const db = require("../config/db");
const {
  aggregateStageFlowFromCustomers,
  computeFunnelConversion,
  computeStageDropOff,
  getTopDropOffStages,
  buildFunnelInsights,
  buildStageInsights,
  buildFunnelAlerts,
  computeFunnelHealth,
} = require("../services/metricsService");

// helper de perÃ­odo
function resolvePeriodDateFrom(period) {
  const now = new Date();

  if (period === "today") {
    const dateFrom = new Date(now);
    dateFrom.setHours(0, 0, 0, 0);
    return dateFrom;
  }

  if (period === "7d") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  if (period === "30d") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return null;
}

// helper de busca de customers por perÃ­odo
async function getCustomersByPeriod(tenant_id, period) {
  const dateFrom = resolvePeriodDateFrom(period);

  let customers;
  if (dateFrom) {
    customers = await db.all(
      `
      SELECT facts_json, created_at
      FROM customers
      WHERE tenant_id = ?
        AND created_at >= ?
      `,
      [tenant_id, dateFrom.toISOString()]
    );
  } else {
    customers = await db.all(
      `
      SELECT facts_json, created_at
      FROM customers
      WHERE tenant_id = ?
      `,
      [tenant_id]
    );
  }

  return {
    customers,
    dateFrom,
  };
}

// helper de construÃ§Ã£o do funil
function buildFunnelResponseData(customers) {
  const funnel = aggregateStageFlowFromCustomers(customers);
  const enrichedFunnel = computeFunnelConversion(funnel);
  const stage_drop_off = computeStageDropOff(enrichedFunnel);
  const stage_insights = buildStageInsights(stage_drop_off);
  const top_drop_off = getTopDropOffStages(stage_drop_off);
  const insights = buildFunnelInsights(stage_drop_off);

  return {
    funnel: enrichedFunnel,
    stage_drop_off,
    stage_insights,
    top_drop_off,
    insights,
  };
}

// helper de snapshot por perÃ­odo
async function buildPeriodSnapshot(tenant_id, period) {
  const { customers, dateFrom } = await getCustomersByPeriod(tenant_id, period);
  const funnelData = buildFunnelResponseData(customers);

  return {
    period,
    date_from: dateFrom ? dateFrom.toISOString() : null,
    total_customers_considered: customers.length,
    ...funnelData,
  };
}

// helper de metadados de comparaÃ§Ã£o
function buildComparisonMeta(currentSnapshot, previousSnapshot) {
  const currentTotal = currentSnapshot.total_customers_considered || 0;
  const previousTotal = previousSnapshot.total_customers_considered || 0;

  let trend = "stable";
  if (currentTotal > previousTotal) trend = "up";
  if (currentTotal < previousTotal) trend = "down";

  let trend_message = "Volume de clientes estÃ¡vel em relaÃ§Ã£o ao perÃ­odo anterior";
  if (trend === "up") {
    trend_message = "Volume de clientes acima do perÃ­odo anterior";
  }
  if (trend === "down") {
    trend_message = "Volume de clientes abaixo do perÃ­odo anterior";
  }

  let customer_delta_percent = null;
  if (previousTotal > 0) {
    customer_delta_percent = Number(
      (((currentTotal - previousTotal) / previousTotal) * 100).toFixed(2)
    );
  }

  const currentHealth = currentSnapshot?.insights?.health || "unknown";
  const previousHealth = previousSnapshot?.insights?.health || "unknown";

  const healthRank = {
    unknown: 0,
    critical: 1,
    warning: 2,
    healthy: 3,
  };

  let health_trend = "stable";
  if ((healthRank[currentHealth] || 0) > (healthRank[previousHealth] || 0)) {
    health_trend = "improved";
  }
  if ((healthRank[currentHealth] || 0) < (healthRank[previousHealth] || 0)) {
    health_trend = "worsened";
  }

  let health_trend_message =
    "SaÃºde do funil estÃ¡vel em relaÃ§Ã£o ao perÃ­odo anterior";
  if (health_trend === "improved") {
    health_trend_message = "SaÃºde do funil melhor que no perÃ­odo anterior";
  }
  if (health_trend === "worsened") {
    health_trend_message = "SaÃºde do funil pior que no perÃ­odo anterior";
  }

  let comparison_summary =
    "Volume e saÃºde estÃ¡veis em relaÃ§Ã£o ao perÃ­odo anterior";

  if (trend === "up" && health_trend === "improved") {
    comparison_summary =
      "Mais clientes que no perÃ­odo anterior e saÃºde do funil melhor";
  } else if (trend === "up" && health_trend === "stable") {
    comparison_summary =
      "Mais clientes que no perÃ­odo anterior com saÃºde estÃ¡vel";
  } else if (trend === "up" && health_trend === "worsened") {
    comparison_summary =
      "Mais clientes que no perÃ­odo anterior, mas com saÃºde do funil pior";
  } else if (trend === "down" && health_trend === "improved") {
    comparison_summary =
      "Menos clientes que no perÃ­odo anterior, mas com saÃºde do funil melhor";
  } else if (trend === "down" && health_trend === "stable") {
    comparison_summary =
      "Menos clientes que no perÃ­odo anterior com saÃºde estÃ¡vel";
  } else if (trend === "down" && health_trend === "worsened") {
    comparison_summary =
      "Menos clientes que no perÃ­odo anterior e saÃºde do funil pior";
  } else if (trend === "stable" && health_trend === "improved") {
    comparison_summary = "Volume estÃ¡vel e saÃºde do funil melhor";
  } else if (trend === "stable" && health_trend === "worsened") {
    comparison_summary = "Volume estÃ¡vel, mas saÃºde do funil pior";
  }

  return {
    current_period: currentSnapshot.period,
    previous_period: previousSnapshot.period,
    current_total_customers: currentTotal,
    previous_total_customers: previousTotal,
    customer_delta: currentTotal - previousTotal,
    customer_delta_percent,
    trend,
    trend_message,
    current_health: currentHealth,
    previous_health: previousHealth,
    health_trend,
    health_trend_message,
    comparison_summary,
  };
}

// helper de comparaÃ§Ã£o por stage
function buildStageComparison(currentSnapshot, previousSnapshot) {
  const currentStages = currentSnapshot?.stage_drop_off || {};
  const previousStages = previousSnapshot?.stage_drop_off || {};

  const stageComparison = {};
  const allStages = new Set([
    ...Object.keys(currentStages),
    ...Object.keys(previousStages),
  ]);

  for (const stage of allStages) {
    if (stage === "pos_checkout") continue;

    const current = currentStages[stage] || {};
    const previous = previousStages[stage] || {};

    const currentEntered = Number(current.entered || 0);
    const currentProgressed = Number(current.progressed || current.advanced || 0);
    const previousEntered = Number(previous.entered || 0);
    const previousProgressed = Number(previous.progressed || previous.advanced || 0);

    const currentRate = currentEntered > 0
      ? Number(((currentProgressed / currentEntered) * 100).toFixed(2))
      : Number(current.conversion_rate || 0);

    const previousRate = previousEntered > 0
      ? Number(((previousProgressed / previousEntered) * 100).toFixed(2))
      : Number(previous.conversion_rate || 0);

    let trend = "stable";
    if (currentRate > previousRate) trend = "up";
    if (currentRate < previousRate) trend = "down";

    let delta = null;
    if (previousEntered > 0 || previousRate > 0) {
      delta = Number((currentRate - previousRate).toFixed(2));
    } else if (currentRate > 0) {
      delta = currentRate;
    }

    stageComparison[stage] = {
      current_conversion_rate: currentRate,
      previous_conversion_rate: previousRate,
      current_entered: currentEntered,
      current_progressed: currentProgressed,
      previous_entered: previousEntered,
      previous_progressed: previousProgressed,
      delta,
      trend,
    };
  }

  return stageComparison;
}

function buildStageComparisonInsights(stageComparison) {
  const insights = {};

  for (const [stage, data] of Object.entries(stageComparison || {})) {
    const current = data.current_conversion_rate || 0;
    const previous = data.previous_conversion_rate || 0;
    const trend = data.trend || "stable";

    let status = "stable";
    let message = `Etapa ${stage} estÃ¡ estÃ¡vel em relaÃ§Ã£o ao perÃ­odo anterior.`;

    if (trend === "up") {
      status = "improving";
      message = `Etapa ${stage} melhorou em relaÃ§Ã£o ao perÃ­odo anterior.`;
    }

    if (trend === "down") {
      status = "worsening";
      message = `Etapa ${stage} piorou em relaÃ§Ã£o ao perÃ­odo anterior.`;
    }

    if (previous === 0 && current > 0) {
      status = "new_signal";
      message = `Etapa ${stage} passou a apresentar conversÃ£o no perÃ­odo atual.`;
    }

    insights[stage] = {
      status,
      message,
      current_conversion_rate: current,
      previous_conversion_rate: previous,
      delta: data.delta,
      trend,
    };
  }

  return insights;
}

// GET /admin/metrics/funnel
router.get("/funnel", async (req, res) => {
  try {
    const tenant_id = req.headers["x-tenant-id"] || 1;
    const period = req.query.period || "all";

    const allowedPeriods = new Set(["today", "7d", "30d", "all"]);
    if (!allowedPeriods.has(period)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_period",
        allowed: ["today", "7d", "30d", "all"],
      });
    }

    const currentSnapshot = await buildPeriodSnapshot(tenant_id, period);

    // lÃ³gica simples de perÃ­odo anterior
    const previousPeriod = period === "30d" ? "7d" : "today";
    const previousSnapshot = await buildPeriodSnapshot(tenant_id, previousPeriod);

    const comparison = buildComparisonMeta(currentSnapshot, previousSnapshot);
    const stage_comparison = buildStageComparison(
      currentSnapshot,
      previousSnapshot
    );
    const stage_comparison_insights =
      buildStageComparisonInsights(stage_comparison);

    // adapta nomes esperados pelo buildFunnelAlerts
    const alertsComparison = {
      ...comparison,
      volume_trend: comparison.trend || "stable",
      delta_volume: comparison.customer_delta || 0,
      current_total: comparison.current_total_customers || 0,
      previous_total: comparison.previous_total_customers || 0,
      health_trend:
        comparison.health_trend === "improved"
          ? "up"
          : comparison.health_trend === "worsened"
          ? "down"
          : "stable",
    };

    const alerts = buildFunnelAlerts({
      funnel: currentSnapshot.funnel,
      stage_drop_off: currentSnapshot.stage_drop_off,
      comparison: alertsComparison,
      stage_comparison,
      stage_comparison_insights,
      health: comparison.current_health || "unknown",
      health_trend: alertsComparison.health_trend,
    });

    return res.json({
      ok: true,
      ...currentSnapshot,
      comparison,
      stage_comparison,
      stage_comparison_insights,
      alerts,
    });
  } catch (err) {
    console.error("metrics funnel error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      stack: err.stack,
    });
  }
});

// GET /admin/metrics/dashboard
router.get("/dashboard", async (req, res) => {
  try {
    const tenant_id = req.headers["x-tenant-id"] || 1;
    const period = req.query.period || "30d";

    const allowedPeriods = new Set(["today", "7d", "30d", "all"]);
    if (!allowedPeriods.has(period)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_period",
        allowed: ["today", "7d", "30d", "all"],
      });
    }

    const currentSnapshot = await buildPeriodSnapshot(tenant_id, period);

    const previousPeriod =
      period === "all" ? "30d" :
      period === "30d" ? "7d" :
      "today";

    const previousSnapshot = await buildPeriodSnapshot(tenant_id, previousPeriod);

    const comparison = buildComparisonMeta(currentSnapshot, previousSnapshot);
    const stage_comparison = buildStageComparison(
      currentSnapshot,
      previousSnapshot
    );
    const stage_comparison_insights =
      buildStageComparisonInsights(stage_comparison);

    const alertsComparison = {
      ...comparison,
      volume_trend: comparison.trend || "stable",
      delta_volume: comparison.customer_delta || 0,
      current_total: comparison.current_total_customers || 0,
      previous_total: comparison.previous_total_customers || 0,
      health_trend:
        comparison.health_trend === "improved"
          ? "up"
          : comparison.health_trend === "worsened"
          ? "down"
          : "stable",
    };

    const alerts = buildFunnelAlerts({
      funnel: currentSnapshot.funnel,
      stage_drop_off: currentSnapshot.stage_drop_off,
      comparison: alertsComparison,
      stage_comparison,
      stage_comparison_insights,
      health: comparison.current_health || "unknown",
      health_trend: alertsComparison.health_trend,
    });

    const alertList = Array.isArray(alerts) ? alerts : [];

    const currentHealth = computeFunnelHealth(currentSnapshot.stage_insights);
    const previousHealth = computeFunnelHealth(previousSnapshot.stage_insights);

    const dashboard_summary = {
      period,
      previous_period: previousPeriod,
      current_total_customers: comparison.current_total_customers || 0,
      previous_total_customers: comparison.previous_total_customers || 0,
      customer_delta: comparison.customer_delta || 0,
      volume_trend: comparison.trend || "stable",
      current_health: currentHealth,
      previous_health: previousHealth,
      health_trend: comparison.health_trend || "stable",
      comparison_summary: comparison.comparison_summary || "",
      total_alerts: alertList.length,
      critical_alerts: alertList.filter(
        (a) =>
          a?.level === "critical" ||
          a?.severity === "critical" ||
          a?.type === "critical"
      ).length,
    };

    return res.json({
      ok: true,
      period,
      previous_period: previousPeriod,
      dashboard_summary,
      funnel: currentSnapshot.funnel,
      stage_drop_off: currentSnapshot.stage_drop_off,
      stage_insights: currentSnapshot.stage_insights,
      insights: currentSnapshot.insights,
      comparison,
      stage_comparison,
      stage_comparison_insights,
      alerts,
      current_snapshot: currentSnapshot,
      previous_snapshot: previousSnapshot,
    });
  } catch (err) {
    console.error("metrics dashboard error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
      stack: err.stack,
    });
  }
});
module.exports = router;




