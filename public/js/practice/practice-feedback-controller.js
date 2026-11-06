/* Completed takes, repeat practice and local challenge presentation. No audio is recorded. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PracticeFeedback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const rounded = value => Number.isFinite(value) ? value.toFixed(1) : '—';
  function sameContext(a, b) {
    return !!(a && b && a.scope && b.scope && !a.mixedContext && !b.mixedContext && a.scope.type !== 'partial' && b.scope.type !== 'partial'
      && ['trackId', 'guideId', 'scoreVersion', 'allowOctave'].every(k => a[k] === b[k])
      && (a.scoreMode || 'relaxed') === (b.scoreMode || 'relaxed')
      && ['key', 'tempo'].every(k => Math.round(a[k] * 1000) === Math.round(b[k] * 1000))
      && a.scope.type === b.scope.type && ['start', 'end'].every(k => Math.round(a.scope[k] * 1000) === Math.round(b.scope[k] * 1000)));
  }
  function diagnosis(line, t) {
    const pitch = line.signedCents == null ? '' : Math.abs(line.signedCents) < 20 ? t(line.absoluteCents > 40 ? 'practice.review.pitchVariable' : 'practice.review.pitchStable')
      : t(line.signedCents > 0 ? 'practice.review.sharp' : 'practice.review.flat', { cents: Math.round(Math.abs(line.signedCents)) });
    const timing = line.onsetMs == null ? t('practice.review.onsetUnknown') : Math.abs(line.onsetMs) < 80 ? t('practice.review.onTime')
      : t(line.onsetMs < 0 ? 'practice.review.early' : 'practice.review.late', { ms: Math.round(Math.abs(line.onsetMs)) });
    return [pitch, timing].filter(Boolean).join(' · ');
  }
  function create(options) {
    const { engine, request, t, document: doc, seek, send, getSnapshot, getSource, getOptions } = options;
    const el = id => doc.getElementById(`practice-${id}`);
    const ui = Object.fromEntries(['review-status', 'weak-lines', 'loop-status', 'loop-stop', 'comparison', 'improved-lines',
      'ghost', 'history', 'history-delete', 'viewer-challenges', 'challenge-target', 'challenge-create', 'challenge-clear',
      'challenge-status', 'challenge-ranking'].map(id => [id, el(id)]));
    const showcase = doc.querySelector('#practice-stage [data-practice-showcase]');
    const ghostCache = new Map();
    let trackId = '', epoch = 0, revision = 0, history = [], selected = null, latest = null, comparison = null;
    let challenge = null, loop = null, pending = null, recap = null, source = '', statusKey = 'empty', saveQueue = Promise.resolve();
    let refreshSerial = 0, ghostSerial = 0, retrySave = null;
    const json = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    function clearRecap() {
      recap = null;
      if (showcase && typeof PracticeShowcase !== 'undefined') PracticeShowcase.render(showcase, null, t);
    }
    function clearGhost() { ghostSerial++; engine.setGhost(null); }
    function context() {
      const s = getSnapshot(); const guide = engine.getGuide();
      const range = engine.getRange();
      return { trackId, guideId: guide && guide.guideId, scoreVersion: 'source-time-v2', key: s && s.pitchShift || 0,
        tempo: s && s.playbackRate || 1, allowOctave: getOptions().allowOctave !== false, scoreMode: getOptions().scoreMode === 'strict' ? 'strict' : 'relaxed', mixedContext: false,
        scope: range ? { type: 'range', ...range } : { type: 'full', start: 0, end: guide && guide.duration || 0 } };
    }
    async function updateGhost() {
      clearGhost();
      if (!ui.ghost.checked || !selected || !sameContext(selected, context())) return;
      const token = ghostSerial, id = trackId, takeId = selected.id;
      const cached = ghostCache.get(takeId);
      if (cached) { engine.setGhost(cached); return; }
      try {
        const result = await request(`/takes/${encodeURIComponent(takeId)}`);
        if (token === ghostSerial && id === trackId && sameContext(result.take, context())) {
          ghostCache.set(takeId, result.take.pitchTrace);
          while (ghostCache.size > 3) ghostCache.delete(ghostCache.keys().next().value);
          engine.setGhost(result.take.pitchTrace);
        }
      } catch (_) { /* Deleted/evicted takes cannot supply a ghost. */ }
    }
    function render() {
      ui['review-status'].textContent = t(`practice.review.${statusKey}`);
      if (statusKey === 'saveFailed' && retrySave) {
        const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-sm';
        retry.textContent = t('practice.review.retry'); retry.addEventListener('click', retrySave); ui['review-status'].appendChild(retry);
      }
      ui['weak-lines'].textContent = '';
      const weak = latest && (latest.weakLines || latest.lineFeedback.filter(l => l.score != null && l.observedSeconds >= Math.max(.3, l.requiredSeconds * .35)).sort((a, b) => a.score - b.score).slice(0, 3)) || [];
      for (const line of weak) {
        const li = doc.createElement('li'), button = doc.createElement('button');
        button.type = 'button'; button.className = 'practice-feedback-line';
        button.textContent = `${line.text} · ${rounded(line.score)} — ${diagnosis(line, t)}`;
        button.addEventListener('click', () => repeatLine(line)); li.appendChild(button); ui['weak-lines'].appendChild(li);
      }
      ui['loop-status'].textContent = loop ? t('practice.review.loop', { text: loop.text }) : t('practice.review.noLoop');
      ui['loop-stop'].disabled = !loop;
      ui.comparison.textContent = comparison && comparison.comparable ? t('practice.review.comparison', {
        previous: rounded(comparison.previous && comparison.previous.score), best: rounded(Math.max(latest && latest.score || 0, comparison.best && comparison.best.score || 0)),
        delta: comparison.delta == null ? '—' : `${comparison.delta >= 0 ? '+' : ''}${rounded(comparison.delta)}`, key: comparison.usualKey,
      }) : t('practice.review.noComparison');
      ui['improved-lines'].textContent = '';
      for (const line of comparison && comparison.improvedLines.slice(0, 3) || []) {
        const li = doc.createElement('li'); li.textContent = t('practice.review.improved', { text: line.text, delta: rounded(line.delta) }); ui['improved-lines'].appendChild(li);
      }
      const chosen = ui.history.value;
      ui.history.textContent = '';
      const empty = doc.createElement('option'); empty.value = ''; empty.textContent = t('practice.review.historyEmpty'); ui.history.appendChild(empty);
      for (const take of history) {
        const opt = doc.createElement('option'); opt.value = take.id;
        opt.textContent = `${new Date(take.createdAt).toLocaleString()} · ${rounded(take.score)} · Key ${take.key} · ×${take.tempo} · ${take.scope.type}`;
        ui.history.appendChild(opt);
      }
      ui.history.value = history.some(take => take.id === chosen) ? chosen : selected && history.some(take => take.id === selected.id) ? selected.id : '';
      ui['history-delete'].disabled = !ui.history.value;
      ui.ghost.disabled = !selected || !sameContext(selected, context());
      ui['challenge-create'].disabled = !trackId;
      ui['challenge-clear'].disabled = !challenge;
      ui['challenge-status'].textContent = challenge ? t('practice.challenge.active', { title: challenge.title, score: rounded(challenge.targetScore), name: challenge.requester || '—' }) : t('practice.challenge.empty');
      ui['challenge-ranking'].textContent = '';
      const current = context();
      const matching = new Set(history.filter(take => sameContext(take, current)).map(take => take.contextFingerprint));
      const entries = (challenge && challenge.trackId === trackId ? challenge.entries : [])
        .filter(entry => matching.has(entry.contextFingerprint))
        .slice().sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
      for (const [i, entry] of entries.entries()) {
        const li = doc.createElement('li'); li.textContent = `${i + 1}. ${rounded(entry.score)} · ${new Date(entry.createdAt).toLocaleString()}`; ui['challenge-ranking'].appendChild(li);
      }
      if (recap && showcase && typeof PracticeShowcase !== 'undefined') PracticeShowcase.render(showcase, recap, t);
    }
    async function refresh() {
      const token = ++refreshSerial, id = trackId;
      if (!id) return;
      try {
        const [takes, active, settings] = await Promise.all([request(`/takes?trackId=${encodeURIComponent(id)}`), request(`/challenges?trackId=${encodeURIComponent(id)}`), request('/challenge-settings')]);
        if (id !== trackId || token !== refreshSerial) return;
        history = takes.takes; challenge = active.challenge; ui['viewer-challenges'].checked = settings.viewerRequestsEnabled;
        if (selected && !history.some(take => take.id === selected.id)) { ghostCache.delete(selected.id); selected = null; clearGhost(); }
        const matches = history.filter(take => sameContext(take, context()));
        if (!selected) selected = matches[0] || null;
        if (!latest && matches.length) {
          const keys = new Map(); history.forEach(take => keys.set(take.key, (keys.get(take.key) || 0) + 1));
          comparison = { comparable: true, previous: matches[0], best: matches.reduce((best, take) => take.score > best.score ? take : best),
            delta: null, usualKey: [...keys.entries()].sort((a, b) => b[1] - a[1])[0][0], improvedLines: [] };
        }
        render(); updateGhost();
      } catch (_) { /* Current feedback remains usable while the server is unavailable. */ }
    }
    function reset(id) {
      epoch++; revision++; refreshSerial++; trackId = String(id || ''); latest = null; comparison = null; history = []; selected = null;
      loop = null; pending = null; retrySave = null; ghostCache.clear(); statusKey = 'empty'; clearGhost(); clearRecap(); render();
    }
    function seekLoop(forceResume = false) {
      const s = getSnapshot();
      if (!loop || !s || !s.valid || !seek(loop.start, { resume: !!s.playing || forceResume })) { stopLoop(); return false; }
      pending = { generation: s.generation, start: loop.start, deadline: Date.now() + 3000 };
      revision++; clearRecap(); engine.setPlaying(false, loop.start);
      return true;
    }
    function repeatLine(line) {
      const guide = engine.getGuide(); if (!guide) return;
      loop = { start: Math.max(0, line.start - .6), end: Math.min(guide.duration, line.end + .3), text: line.text };
      engine.setRange(loop); clearGhost(); seekLoop(); render();
    }
    function stopLoop() {
      loop = null; pending = null; revision++; engine.setRange(null); clearRecap(); clearGhost(); render(); updateGhost();
      const s = getSnapshot(); if (s && s.valid) engine.setPlaying(s.playing && getSource() !== 'off', s.sourceTime);
    }
    function playback(s) {
      if (!s || !s.valid) { pending = null; return false; }
      if (pending) {
        if (Date.now() > pending.deadline) { stopLoop(); return false; }
        if (s.generation !== pending.generation && Math.abs(s.sourceTime - pending.start) < .5) {
          pending = null; engine.startNewPass(); engine.setPlaying(s.playing && getSource() !== 'off', s.sourceTime); updateGhost();
        }
        return true;
      }
      if (loop && s.playing && getSource() !== 'off' && s.sourceTime >= loop.end) {
        engine.finish(getSource(), { end: loop.end }); return seekLoop();
      }
      if (loop && (s.sourceTime < loop.start - .7 || s.sourceTime > loop.end + .7)) stopLoop();
      return false;
    }
    function boundary(snapshot) {
      if (!loop || getSource() === 'off') return false;
      engine.finish(getSource(), { end: loop.end }); return seekLoop(!!(snapshot && snapshot.wasPlaying));
    }
    function finish(take) {
      latest = take; comparison = null; retrySave = null; source = take.source;
      const s = getSnapshot(), capturedChallenge = challenge;
      const id = trackId, capturedEpoch = epoch, capturedRevision = ++revision;
      const payload = { ...take, clientTakeId: options.makeId ? options.makeId() : crypto.randomUUID(), trackId: id,
        title: s && s.track && [s.track.title, s.track.artist].filter(Boolean).join(' — ') || '', duration: engine.getGuide().duration,
        challengeId: capturedChallenge && capturedChallenge.trackId === id ? capturedChallenge.id : null, completed: true, valid: true };
      const eligible = source === 'mic' && Number.isFinite(take.score) && take.observedSeconds >= 2 && take.voicedSeconds >= .5;
      statusKey = source === 'demo' ? 'demo' : eligible ? 'saving' : 'insufficient'; render();
      if (!eligible) return;
      const save = async () => {
        try {
          const result = await request('/takes', json('POST', payload));
          if (capturedEpoch !== epoch || !result.take) return;
          if (latest === take || capturedRevision === revision) retrySave = null;
          if (capturedRevision !== revision) {
            if (latest === take) { latest = { ...take, ...result.take }; comparison = result.comparison; statusKey = 'saved'; render(); }
            await refresh(); return;
          }
          latest = { ...take, ...result.take }; comparison = result.comparison; statusKey = 'saved';
          const previous = comparison && comparison.previous;
          selected = previous ? history.find(take => take.id === previous.id) || (previous.scope ? previous : selected) : selected;
          const cr = result.challengeResult;
          recap = { takeId: result.take.id, trackId: id, score: result.take.score,
            personalBest: !!(comparison && comparison.comparable && result.take.scope.type === 'full' && comparison.isPersonalBest),
            previousDelta: comparison && comparison.delta, bestScore: comparison && comparison.comparable ? Math.max(result.take.score, comparison.best && comparison.best.score || 0) : null,
            challenge: cr && cr.eligible ? { challengeId: cr.challengeId, requester: capturedChallenge.requester,
              targetScore: cr.targetScore, achieved: cr.achieved, rank: cr.rank, participationCount: cr.participants } : null };
          send({ type: 'recap', recap }); render(); await refresh();
        } catch (_) {
          if (capturedEpoch === epoch && (capturedRevision === revision || latest === take)) {
            statusKey = 'saveFailed'; retrySave = () => {
              retrySave = null; statusKey = 'saving'; render(); saveQueue = saveQueue.catch(() => {}).then(save); return saveQueue;
            }; render();
          }
        }
      };
      saveQueue = saveQueue.catch(() => {}).then(save);
      return saveQueue;
    }
    ui['loop-stop'].addEventListener('click', stopLoop);
    ui.ghost.addEventListener('change', updateGhost);
    ui.history.addEventListener('change', async () => {
      selected = history.find(take => take.id === ui.history.value) || null;
      const take = selected, token = epoch;
      updateGhost(); render();
      if (!take) return;
      try { const result = await request(`/takes/${encodeURIComponent(take.id)}`);
        if (token === epoch && selected && selected.id === take.id) { latest = result.take; comparison = null; statusKey = 'saved'; render(); }
      } catch (_) { /* A concurrent deletion is handled by the next refresh. */ }
    });
    ui['history-delete'].addEventListener('click', async () => {
      const id = ui.history.value; if (!id) return;
      // 刪掉就回不來（上次／最佳比較也會跟著變），先確認
      const confirmer = ((doc && doc.defaultView) || globalThis).PanelConfirm;
      if (confirmer && !await confirmer.request({ title: t('practice.history.deleteTitle'), summary: t('practice.history.deleteSummary'),
        confirmLabel: t('practice.history.deleteConfirm'), tone: 'danger' })) return;
      try { await request(`/takes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        ghostCache.delete(id);
        if (selected && selected.id === id) { selected = null; clearGhost(); }
        if (latest && latest.id === id) { latest = null; comparison = null; statusKey = 'empty'; clearRecap(); }
        await refresh();
      } catch (_) { statusKey = 'saveFailed'; render(); }
    });
    ui['viewer-challenges'].addEventListener('change', async () => {
      const value = ui['viewer-challenges'].checked; ui['viewer-challenges'].disabled = true;
      try { await request('/challenge-settings', json('PATCH', { viewerRequestsEnabled: value })); }
      catch (_) { ui['viewer-challenges'].checked = !value; }
      finally { ui['viewer-challenges'].disabled = false; }
    });
    ui['challenge-create'].addEventListener('click', async () => {
      const s = getSnapshot(), id = trackId; if (!id) return;
      ui['challenge-create'].disabled = true;
      try { await request('/challenges', json('POST', { trackId: id, title: s.track.title || '', targetScore: Number(ui['challenge-target'].value), requester: '' })); await refresh(); }
      catch (_) { ui['challenge-status'].textContent = t('practice.challenge.failed'); }
      finally { ui['challenge-create'].disabled = !trackId; }
    });
    ui['challenge-clear'].addEventListener('click', async () => {
      if (!challenge) return;
      try { await request(`/challenges/${encodeURIComponent(challenge.id)}`, { method: 'DELETE' }); challenge = null; render(); }
      catch (_) { ui['challenge-status'].textContent = t('practice.challenge.failed'); }
    });
    render();
    // 任意區段循環（練唱頁上方的 A–B 循環）；跟「重唱這句」同一套：等播放器確認跳轉後才開始新一輪
    // 播放器只在播放／暫停／跳轉時送快照，平常播放中不會；循環的「到 B 點」要靠練唱頁用即時時鐘每 50ms 問一次
    function tick(time) {
      const s = getSnapshot();
      if (!loop || pending || !s || !s.valid || !s.playing || !(time >= loop.end)) return false;
      if (getSource() !== 'off') engine.finish(getSource(), { end: loop.end });
      return seekLoop(true);
    }
    function loopRange(start, end, text = '') {
      const guide = engine.getGuide();
      if (!guide || !(end - start >= 0.5)) return false;
      loop = { start: Math.max(0, start), end: Math.min(guide.duration, end), text };
      engine.setRange(loop); clearGhost(); seekLoop(); render();
      return true;
    }
    return { reset, refresh, render, finish, playback, boundary, loopRange, stopLoop, tick, isLooping: () => !!loop,
      acceptsPitch: mapped => !pending && (mapped.generation == null || !getSnapshot() || mapped.generation === getSnapshot().generation)
        && (!loop || mapped.t >= loop.start && mapped.t <= loop.end),
      cancel: () => { revision++; pending = null; loop = null; engine.setRange(null); clearRecap(); clearGhost(); render(); },
      contextChanged: () => { revision++; clearRecap(); clearGhost(); render(); updateGhost(); },
      reconnect: () => { if (recap) send({ type: 'recap', recap }); } };
  }
  return { create, sameContext, diagnosis };
});
