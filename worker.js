export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/fmcsa') {
      return handleFMCSA(url, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleFMCSA(url, env) {
  const mc     = (url.searchParams.get('mc')   || '').replace(/\D/g, '');
  const name   = url.searchParams.get('name')  || '';
  const dot    = (url.searchParams.get('dot')  || '').replace(/\D/g, '');
  const webKey = env.FMCSA_KEY;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (!webKey) {
    return new Response(JSON.stringify({ error: 'FMCSA_KEY not configured' }), { status: 500, headers });
  }

  // DOT lookup — used by the FMCSA Rating page
  if (dot) {
    try {
      const res = await fetch(
        `https://mobile.fmcsa.dot.gov/qc/services/carriers/${dot}?webKey=${webKey}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) return new Response(JSON.stringify({ error: 'FMCSA returned ' + res.status }), { status: res.status, headers });
      const json = await res.json();
      return new Response(JSON.stringify(json), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers });
    }
  }

  // MC + name lookup — used by Credit Check
  let primary      = null;
  let alternatives = [];

  if (mc) {
    try {
      const res = await fetch(
        `https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/${mc}?webKey=${webKey}`,
        { headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const json = await res.json();
        const c = json?.content?.carrier || json?.content;
        if (c && (c.dotNumber || c.legalName)) primary = c;
      }
    } catch (_) {}
  }

  if (name) {
    try {
      const res = await fetch(
        `https://mobile.fmcsa.dot.gov/qc/services/carriers?name=${encodeURIComponent(name)}&start=0&size=6&webKey=${webKey}`,
        { headers: { Accept: 'application/json' } }
      );
      if (res.ok) {
        const json = await res.json();
        const list = json?.content?.Carrier || json?.content || [];
        alternatives = (Array.isArray(list) ? list : [list]).filter(Boolean);
        if (!primary && alternatives.length) primary = alternatives[0];
      }
    } catch (_) {}
  }

  return new Response(JSON.stringify({ primary, alternatives }), { headers });
}
