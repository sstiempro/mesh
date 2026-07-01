// forged 2026-07-01T11:31:55.640Z for category "AI Agents" — verify result: {"ok":true,"level":"alert","signal":"Dominant protocol MorpheusAI has 55% of total TVL","alerts":[{"name":"MorpheusAI","tvl":11630767.370516269,"change_1h":0.17066355541712142,"change_1d":-0.5361093262283418,"change_7d":-4.917686589911824},{"name":"ZyFAI","tvl":6324670.175829712,"change_1h":0.07737740750140176,"change_1d":2.4022218705378435,"change_7d":22.642919488005546},{"name":"Capx AI","tvl":2203279.7141617937,"change_1h":-0.12200564220069054,"change_1d":-0.9998306206241665,"change_7d":-1.7895650876929352},{"name":"Gud.Tech","tvl":28783.875188497146,"change_1h":2.6390081703827235,"change_1d":-12.878630678199954,"change_7d":-4.530783072433238}]}
async function monitor(params) {
  const tvlThreshold = params.tvlThreshold ?? 1000000;
  const dominanceThreshold = params.dominanceThreshold ?? 0.5;
  const changeThreshold = params.changeThreshold ?? 10;

  const protocolsResponse = await gjT('https://api.llama.fi/protocols');
  if (!protocolsResponse) return { ok: false };

  const aiAgents = protocolsResponse.filter(protocol => protocol.category === 'AI Agents');
  if (aiAgents.length === 0) return { ok: true, level: 'ok', signal: 'No AI Agents found', alerts: [] };

  const totalTvl = aiAgents.reduce((acc, protocol) => acc + protocol.tvl, 0);
  const dominantProtocol = aiAgents.reduce((max, protocol) => protocol.tvl > max.tvl ? protocol : max, aiAgents[0]);
  const dominantTvl = dominantProtocol.tvl;
  const dominance = dominantTvl / totalTvl;

  const notableProtocols = aiAgents.filter(protocol => {
    return protocol.tvl > tvlThreshold ||
           Math.abs(protocol.change_1h) > changeThreshold ||
           Math.abs(protocol.change_1d) > changeThreshold ||
           Math.abs(protocol.change_7d) > changeThreshold;
  });

  const alerts = notableProtocols.map(protocol => ({
    name: protocol.name,
    tvl: protocol.tvl,
    change_1h: protocol.change_1h,
    change_1d: protocol.change_1d,
    change_7d: protocol.change_7d
  }));

  let level, signal;
  if (dominance > dominanceThreshold) {
    level = 'alert';
    signal = `Dominant protocol ${dominantProtocol.name} has ${Math.round(dominance * 100)}% of total TVL`;
  } else if (alerts.length > 0) {
    level = 'signal';
    signal = `Notable activity in AI Agents: ${alerts.map(alert => alert.name).join(', ')}`;
  } else {
    level = 'ok';
    signal = 'AI Agents are stable';
  }

  return { ok: true, level, signal, alerts };
}
