// Renders /v1/stats. Everything here is aggregate: counts per bucket, shares, medians.
const $ = (id) => document.getElementById(id);
const LOAD = { lt1s: 'under 1s', lt2_5s: '1–2.5s', lt4s: '2.5–4s', gte4s: 'over 4s' };
const SIZE_ORDER = ['0', '1-10', '11-50', '51-100', '101-500', '500+'];
const VOLUME_ORDER = ['0', '1-100', '101-1000', '1001-10000', '10000+'];

function bars(el, entries, { percent = false } = {}) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  el.replaceChildren(
    ...entries.map(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'bar';
      const name = document.createElement('span');
      name.textContent = label;
      const track = document.createElement('b');
      const fill = document.createElement('i');
      fill.style.width = `${(percent ? value : (value / max) * 100).toFixed(1)}%`;
      track.append(fill);
      const num = document.createElement('em');
      num.textContent = percent ? `${value}%` : String(value);
      row.append(name, track, num);
      return row;
    }),
  );
  if (!entries.length) el.textContent = 'No data yet.';
}

const ordered = (obj, order) => (order ? order.filter((k) => k in obj).map((k) => [k, obj[k]]) : Object.entries(obj).sort((a, b) => b[1] - a[1]));

function history(svg, points) {
  svg.replaceChildren();
  if (points.length < 2) return;
  const max = Math.max(1, ...points.map((p) => p.installs30d));
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 600},${150 - (p.installs30d / max) * 140}`).join(' ');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '2.5');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
}

fetch('/v1/stats')
  .then((r) => r.json())
  .then((s) => {
    $('status').hidden = true;
    $('content').hidden = false;
    $('installs').textContent = s.installs30d ?? 0;
    $('p95').textContent = s.health?.medianFunctionP95Ms == null ? '–' : `${s.health.medianFunctionP95Ms} ms`;
    $('errors').textContent = s.health?.installsWithErrorsPct == null ? '–' : `${s.health.installsWithErrorsPct}%`;
    $('reads').textContent = s.cost?.medianReadsPctOfFree == null ? '–' : `${s.cost.medianReadsPctOfFree}%`;
    history($('history'), s.history ?? []);
    bars($('versions'), ordered(s.versions ?? {}));
    bars($('teamSize'), ordered(s.teamSize ?? {}, SIZE_ORDER));
    bars($('messages'), ordered(s.messagesPerDay ?? {}, VOLUME_ORDER));
    bars($('pageLoad'), Object.entries(LOAD).filter(([k]) => s.health?.pageLoadP75?.[k]).map(([k, label]) => [label, s.health.pageLoadP75[k]]));
    bars($('regions'), ordered(s.regions ?? {}));
    const f = s.features ?? {};
    bars(
      $('features'),
      [
        ['Push notifications', f.push ?? 0],
        ['HTTP API', f.api ?? 0],
        ['Reminders / scheduling', f.scheduling ?? 0],
        ['Custom branding', f.customized ?? 0],
      ],
      { percent: true },
    );
    if (s.updatedAt) $('updated').textContent = `Updated ${new Date(s.updatedAt).toLocaleString()}.`;
  })
  .catch(() => ($('status').textContent = 'Statistics are not available right now.'));
