/*
 * Elitesand Pro — Wordscape / 字界巡航
 *
 * Production host adapter for the accepted clean-room V10.3.2 continuous
 * glyph world. The first two self-contained modules are the same deterministic
 * layout compiler and per-glyph paint/motion engine used by the approved demo.
 * The final module binds them to LyricTemplates and the host's absolute clock.
 */
/*
 * Elitesand Pro / Lyric Stage generic layout compiler v10
 *
 * This file is deliberately data-only and DOM-free.  It turns a timed lyric
 * document into a stable glyph timeline plus measured-layout metadata.  The
 * renderer can supply real font measurements later through `layout()`; the
 * fallback metrics are only used to make the compiler inspectable in Node.
 */
(() => {
  'use strict';

  const VERSION = '10.1.2-generic-salience';
  const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('zh-TW', { granularity: 'grapheme' })
    : null;
  const wordSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('zh-TW', { granularity: 'word' })
    : null;
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const cleanText = value => String(value == null ? '' : value).replace(/\u00a0/g, ' ');
  const isSpace = value => /^\s+$/u.test(value);
  const lexicalChar = value => /^[\p{L}\p{N}]$/u.test(value);
  const MAX_HERO_GRAPHEMES = 8;
  // Short grammatical glue can be held longer than the surrounding nouns or
  // verbs in karaoke timing. It remains fully visible/timed, but should not win
  // a typographic emphasis contest on duration alone.
  const SINGLE_GRAPHEME_FUNCTION_WORDS = new Set(Array.from(
    '的地得了著過嗎呢吧啊呀嘛啦喔哦和與及或而在於從向對把被讓給為以也都就才又還はがをにへとでのもやかねよ'
  ));
  // Character-class fallback for phrases made entirely from grammatical
  // helpers. It intentionally contains no full words or song phrases.
  const GRAMMATICAL_GRAPHEMES = new Set(Array.from(
    '的地得了著過嗎呢吧啊呀嘛啦喔哦和與及或而且在於從向對把被讓給為以也都就才又還仍再將正不沒別可會能要應該須需若如因故但則我你他她它這那哪誰はがをにへとでのもやかねよ'
  ));
  const SINGLETON_MERGE_BREAKS = new Set(Array.from(
    '的地得了著過嗎呢吧啊呀嘛啦喔哦和與及或而在於從向對把被讓給為以也都就才又還我你他她它要會能可別不沒很太最再將正'
  ));

  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function unit(value, fallback = 0) {
    const number = finite(value, fallback);
    return number >= 0 ? number : fallback;
  }

  function graphemes(value) {
    const text = cleanText(value);
    const parts = segmenter
      ? Array.from(segmenter.segment(text), part => part.segment)
      : Array.from(text);
    return parts.filter(part => !isSpace(part));
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const position = (sorted.length - 1) * clamp(ratio, 0, 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function robustGapThreshold(gaps, options) {
    const positive = gaps.filter(gap => gap > 0);
    if (!positive.length) return unit(options.hardClearMinMs, 4200);
    const median = percentile(positive, .5);
    const deviations = positive.map(gap => Math.abs(gap - median));
    const mad = percentile(deviations, .5);
    const floor = unit(options.hardClearMinMs, 4200);
    // MAD keeps a song with naturally loose phrasing from getting a hard
    // clear for every ordinary breath, while still exposing an outlier gap.
    return Math.max(floor, median + Math.max(900, mad * 6));
  }

  function readWords(line) {
    const source = Array.isArray(line && line.words) ? line.words : [];
    if (!source.length) return [];
    if (typeof source[0] === 'object' && source[0] !== null) {
      return source.map((word, index) => {
        const hasAbsoluteStart = word.absoluteStartMs != null
          && Number.isFinite(Number(word.absoluteStartMs));
        return {
          text: cleanText(word.text ?? word.value ?? word.raw),
          startMs: hasAbsoluteStart ? Number(word.absoluteStartMs)
            : finite(word.startMs ?? word.time ?? word.start, 0),
          durationMs: finite(word.durationMs ?? word.duration, 0),
          index,
          absolute: hasAbsoluteStart || Boolean(word.absolute),
        };
      });
    }
    const result = [];
    for (let index = 0; index < source.length; index += 3) {
      result.push({
        text: cleanText(source[index]),
        startMs: finite(source[index + 1], 0),
        durationMs: finite(source[index + 2], 0),
        index: result.length,
        absolute: false,
      });
    }
    return result;
  }

  function normalizeSong(input, options = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const rawLines = Array.isArray(source.lines) ? source.lines : [];
    const wordStartMode = options.wordStartMode || 'relative';
    const lines = rawLines.map((rawLine, lineIndex) => {
      const lineTime = unit(rawLine.time ?? rawLine.startMs, 0);
      const rawWords = readWords(rawLine);
      const text = cleanText(rawLine.text || rawWords.map(word => word.text).join(''));
      const declaredDuration = unit(rawLine.duration ?? rawLine.durationMs, 0);
      const wordsForLine = rawWords.length ? rawWords : (text ? [{
        text,
        startMs: 0,
        durationMs: declaredDuration,
        index: 0,
        absolute: false,
      }] : []);
      const lineWords = wordsForLine.map(word => {
        const startMs = word.absolute || wordStartMode === 'absolute'
          ? unit(word.startMs, lineTime)
          : lineTime + unit(word.startMs, 0);
        return { ...word, startMs };
      }).filter(word => word.text.length > 0);
      return {
        sourceIndex: lineIndex,
        time: lineTime,
        duration: declaredDuration,
        text,
        words: lineWords,
      };
    });

    lines.forEach((line, index) => {
      const nextTime = lines[index + 1] ? lines[index + 1].time : 0;
      const lastWordEnd = line.words.reduce((end, word) => Math.max(end, word.startMs + unit(word.durationMs)), line.time);
      const inferredEnd = Math.max(lastWordEnd, nextTime > line.time ? nextTime : line.time + 750);
      line.duration = line.duration > 0 ? line.duration : inferredEnd - line.time;
      let cursor = line.time;
      line.words.forEach((word, wordIndex) => {
        const nextStart = line.words[wordIndex + 1] ? line.words[wordIndex + 1].startMs : line.time + line.duration;
        const end = word.startMs + unit(word.durationMs);
        const duration = unit(word.durationMs) > 0
          ? unit(word.durationMs)
          : Math.max(1, nextStart - word.startMs);
        word.durationMs = duration;
        cursor = Math.max(cursor, word.startMs + duration);
      });
    });

    const lastEnd = lines.reduce((end, line) => Math.max(end, line.time + line.duration), 0);
    return {
      title: cleanText(source.title),
      artist: cleanText(source.artist),
      totalMs: Math.max(unit(source.totalMs, 0), lastEnd),
      lines,
    };
  }

  function expandGlyphTimeline(song) {
    const glyphs = [];
    const normalizedLines = song.lines.map((line, lineIndex) => {
      const tokens = [];
      let sequenceIndex = 0;
      line.words.forEach((word, wordIndex) => {
        const parts = graphemes(word.text);
        if (!parts.length) return;
        const duration = Math.max(1, unit(word.durationMs, 1));
        const slot = duration / parts.length;
        const token = {
          lineIndex,
          wordIndex,
          text: word.text,
          startMs: word.startMs,
          durationMs: duration,
          graphemeCount: parts.length,
          glyphs: [],
        };
        parts.forEach((char, charIndex) => {
          const glyph = {
            id: `${lineIndex}:${wordIndex}:${charIndex}`,
            char,
            lineIndex,
            wordIndex,
            charIndex,
            sequenceIndex,
            enterAtMs: word.startMs + slot * charIndex,
            intervalEndMs: word.startMs + slot * (charIndex + 1),
            sourceSlotMs: slot,
          };
          sequenceIndex += 1;
          token.glyphs.push(glyph);
          glyphs.push(glyph);
        });
        tokens.push(token);
      });
      return { ...line, lineIndex, tokens, glyphs: tokens.flatMap(token => token.glyphs) };
    });
    return { lines: normalizedLines, glyphs };
  }

  function fallbackVisualTokens(line) {
    return line.tokens.map((token, layoutIndex) => ({
      ...token,
      layoutIndex,
      sourceWordIndices: [token.wordIndex],
      explicitGap: /\s$/u.test(token.text),
    }));
  }

  function refineCjkSingletonRuns(units) {
    const refined = [];
    const mergeable = unit => unit.wordLike !== false
      && unit.graphemeCount === 1
      && /^\p{Script=Han}$/u.test(unit.text)
      && !SINGLETON_MERGE_BREAKS.has(unit.text);
    let index = 0;
    while (index < units.length) {
      if (!mergeable(units[index])) {
        refined.push(units[index]);
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < units.length && !units[end].explicitGap && mergeable(units[end])) end += 1;
      const run = units.slice(index, end);
      if (run.length < 2) {
        refined.push(run[0]);
        index = end;
        continue;
      }
      let cursor = 0;
      while (cursor < run.length) {
        const remaining = run.length - cursor;
        let size = Math.min(4, remaining);
        if (remaining - size === 1) size -= 1;
        const chunk = run.slice(cursor, cursor + size);
        const glyphsInChunk = chunk.flatMap(unit => unit.glyphs);
        refined.push({
          ...chunk[0],
          text: chunk.map(unit => unit.text).join(''),
          durationMs: glyphsInChunk.at(-1).intervalEndMs - glyphsInChunk[0].enterAtMs,
          graphemeCount: glyphsInChunk.length,
          glyphs: glyphsInChunk,
          sourceWordIndices: [...new Set(chunk.flatMap(unit => unit.sourceWordIndices))],
        });
        cursor += size;
      }
      index = end;
    }
    return refined.map((unit, wordIndex) => ({ ...unit, layoutIndex: wordIndex, wordIndex }));
  }

  function buildSemanticVisualTokens(line) {
    if (!wordSegmenter || !line.text || !line.glyphs.length) return fallbackVisualTokens(line);
    let parts;
    try {
      parts = Array.from(wordSegmenter.segment(line.text));
    } catch {
      return fallbackVisualTokens(line);
    }
    const units = [];
    let cursor = 0;
    let pendingGap = false;
    for (const part of parts) {
      const chars = graphemes(part.segment);
      if (!chars.length) {
        if (/\s/u.test(part.segment)) pendingGap = true;
        continue;
      }
      const unitGlyphs = line.glyphs.slice(cursor, cursor + chars.length);
      if (unitGlyphs.length !== chars.length
        || unitGlyphs.map(glyph => glyph.char).join('') !== chars.join('')) {
        return fallbackVisualTokens(line);
      }
      cursor += chars.length;
      const sourceWordIndices = [...new Set(unitGlyphs.map(glyph => glyph.wordIndex))];
      const startMs = unitGlyphs[0].enterAtMs;
      const endMs = unitGlyphs.at(-1).intervalEndMs;
      const punctuationOnly = part.isWordLike === false && /^[\p{P}\p{S}]+$/u.test(chars.join(''));
      const previous = units.at(-1);
      if (punctuationOnly && previous && !pendingGap) {
        previous.text += chars.join('');
        previous.glyphs.push(...unitGlyphs);
        previous.graphemeCount = previous.glyphs.length;
        previous.durationMs = endMs - previous.startMs;
        previous.sourceWordIndices = [...new Set([...previous.sourceWordIndices, ...sourceWordIndices])];
      } else {
        units.push({
          layoutIndex: units.length,
          wordIndex: units.length,
          text: chars.join(''),
          startMs,
          durationMs: Math.max(1, endMs - startMs),
          graphemeCount: unitGlyphs.length,
          glyphs: unitGlyphs,
          sourceWordIndices,
          explicitGap: pendingGap,
          wordLike: part.isWordLike !== false,
        });
      }
      pendingGap = false;
    }
    if (cursor !== line.glyphs.length) return fallbackVisualTokens(line);
    return refineCjkSingletonRuns(units);
  }

  function heroSemantics(token) {
    const lexical = token.glyphs.map(glyph => glyph.char).filter(lexicalChar);
    const normalized = lexical.join('').normalize('NFKC').toLocaleLowerCase();
    const punctuationOnly = lexical.length === 0;
    const functionWord = lexical.length === 1 && SINGLE_GRAPHEME_FUNCTION_WORDS.has(normalized);
    const oversized = lexical.length > MAX_HERO_GRAPHEMES;
    const possessive = /^(?:我|你|他|她|它|我們|你們|他們|她們|它們)的$/u.test(normalized);
    const grammaticalOnly = lexical.length > 1
      && lexical.every(char => GRAMMATICAL_GRAPHEMES.has(char.normalize('NFKC').toLocaleLowerCase()));
    const uniqueness = lexical.length ? new Set(lexical).size / lexical.length : 0;
    // Repeated shapes such as AA/AAA remain rhythmic support unless timing and
    // position clearly make them the focal point. This is structural rather
    // than a vocabulary list, so unseen songs receive the same treatment.
    const emphasis = possessive ? .38 : grammaticalOnly ? .74 : .58 + uniqueness * .42;
    return {
      lexicalCount: lexical.length,
      eligible: !punctuationOnly && !functionWord && !oversized,
      emphasis,
    };
  }

  function classifyLines(lines, glyphs) {
    const repeats = new Map();
    lines.forEach(line => repeats.set(line.text, (repeats.get(line.text) || 0) + 1));
    const metrics = lines.map(line => {
      const count = line.glyphs.length;
      const span = Math.max(1, line.duration);
      const density = count / span * 1000;
      const repetition = repeats.get(line.text) || 1;
      return { count, density, repetition, sustain: span, score: 0 };
    });
    const counts = metrics.map(metric => metric.count);
    const densities = metrics.map(metric => metric.density);
    const sustains = metrics.map(metric => metric.sustain);
    metrics.forEach(metric => {
      metric.score = metric.count / Math.max(1, percentile(counts, .5)) * .28
        + metric.density / Math.max(.001, percentile(densities, .5)) * .20
        + metric.sustain / Math.max(1, percentile(sustains, .5)) * .22
        + Math.min(2, metric.repetition) * .15;
    });
    const heroCut = percentile(metrics.map(metric => metric.score), .76);
    const semiCut = percentile(metrics.map(metric => metric.score), .43);
    return lines.map((line, index) => {
      const metric = metrics[index];
      const role = metric.score >= heroCut || metric.sustain >= percentile(sustains, .9)
        ? 'hero' : metric.score >= semiCut ? 'semi' : 'support';
      const mode = metric.density >= percentile(densities, .78) ? 'packing'
        : line.glyphs.length <= 4 ? 'single'
          : metric.sustain >= percentile(sustains, .72) ? 'hold' : 'ribbon';
      const sourceTokens = line.tokens;
      const visualTokens = buildSemanticVisualTokens(line);
      const tokenRepeats = new Map();
      visualTokens.forEach(token => tokenRepeats.set(token.text, (tokenRepeats.get(token.text) || 0) + 1));
      const tokenScores = visualTokens.map(token => {
        const semantics = heroSemantics(token);
        const relativePosition = visualTokens.length > 1
          ? token.wordIndex / (visualTokens.length - 1) : .5;
        // Square-root duration keeps a long karaoke melisma from automatically
        // becoming giant. A modest end-of-phrase rise gives the composition a
        // readable cadence without recognizing any lyric text or song identity.
        const durationWeight = Math.sqrt(Math.max(1, Math.min(2800, token.durationMs)));
        const semanticWeight = 1 + .55 * Math.sqrt(Math.max(1,
          Math.min(token.graphemeCount, MAX_HERO_GRAPHEMES)));
        const cadenceWeight = visualTokens.length > 1 ? .94 + relativePosition * .30 : 1;
        return {
          token,
          semantics,
          score: durationWeight * semanticWeight * cadenceWeight * semantics.emphasis
            / (1 + Math.max(0, (tokenRepeats.get(token.text) || 1) - 1) * .55),
        };
      });
      const heroToken = tokenScores.filter(item => item.semantics.eligible).reduce((best, item) => (
        !best || item.score > best.score ? item : best
      ), null);
      const heroWordIndex = heroToken ? heroToken.token.wordIndex : -1;
      const wordLikeCount = tokenScores.length;
      const semiCandidates = tokenScores
        .filter(item => item.token.wordIndex !== heroWordIndex
          && item.semantics.lexicalCount >= 2
          && item.semantics.lexicalCount <= MAX_HERO_GRAPHEMES
          && Math.abs(item.token.wordIndex - heroWordIndex) >= 2
          && item.score >= (heroToken ? heroToken.score * .35 : Infinity))
        .sort((a, b) => b.score - a.score);
      const semiWordIndices = [];
      if (wordLikeCount >= 4 && semiCandidates.length) {
        const heroLeansEarly = heroWordIndex <= (visualTokens.length - 1) / 2;
        const primary = semiCandidates.find(item => (
          heroLeansEarly
            ? item.token.wordIndex > heroWordIndex
            : item.token.wordIndex < heroWordIndex
        )) || semiCandidates[0];
        if (primary) semiWordIndices.push(primary.token.wordIndex);
        if (wordLikeCount >= 9) {
          const secondary = semiCandidates.find(item => primary
            && item.token.wordIndex !== primary.token.wordIndex
            && Math.abs(item.token.wordIndex - primary.token.wordIndex) >= 2
            && (heroLeansEarly
              ? item.token.wordIndex < heroWordIndex
              : item.token.wordIndex > heroWordIndex));
          if (secondary) semiWordIndices.push(secondary.token.wordIndex);
        }
      }
      const tokens = visualTokens.map(token => ({
        ...token,
        role: token.wordIndex === heroWordIndex
          ? 'hero'
          : semiWordIndices.includes(token.wordIndex) ? 'semi' : 'support',
      }));
      const lineGlyphs = tokens.flatMap(token => token.glyphs);
      return {
        ...line,
        sourceTokens,
        tokens,
        glyphs: lineGlyphs,
        role,
        metric,
        heroWordIndex,
        semiWordIndices,
        template: {
          mode,
          motif: hash(`${line.text}|${line.time}|${line.duration}`) % 8,
          stagger: (hash(`${line.text}|${index}`) % 5) * .012,
          rotateDeg: ((hash(`${line.text}|angle`) % 17) - 8) * .035,
          scale: .96 + (hash(`${line.text}|scale`) % 9) * .01,
        },
      };
    });
  }

  function makeShots(lines, hardClears, options) {
    const maxLines = Math.max(1, Math.min(4, finite(options.maxShotLines, 4)));
    const maxSpan = Math.max(1000, finite(options.maxShotSpanMs, 6000));
    const clearSet = new Set(hardClears.map(range => `${range[0]}:${range[1]}`));
    const shots = [];
    let current = null;
    lines.forEach((line, index) => {
      const previous = lines[index - 1];
      const gap = previous ? line.time - (previous.time + previous.duration) : Infinity;
      const clearBefore = previous && hardClears.some(range => line.time >= range[1] && previous.time < range[0]);
      const span = current ? line.time + line.duration - current.startMs : 0;
      const denseEnough = current && gap <= finite(options.shotGapMs, 1400);
      if (!current || clearBefore || !denseEnough || current.lines.length >= maxLines || span > maxSpan) {
        current = {
          id: `shot-${String(shots.length + 1).padStart(2, '0')}`,
          startMs: line.time,
          endMs: line.time + line.duration,
          lines: [],
          template: line.template,
        };
        shots.push(current);
      }
      current.lines.push(index);
      current.endMs = Math.max(current.endMs, line.time + line.duration);
    });
    return shots.map(shot => ({
      ...shot,
      lineCount: shot.lines.length,
      spanMs: shot.endMs - shot.startMs,
      hardClearBefore: hardClears.some(range => shot.startMs >= range[1]),
      hardClearKey: clearSet.size,
    }));
  }

  function estimateGlyphWidth(char, size) {
    if (/^[\u0000-\u00ff]$/u.test(char)) return size * .58;
    if (/^[\s\p{P}\p{S}]$/u.test(char)) return size * .62;
    return size * .98;
  }

  function defaultMeasure(glyph, line) {
    const size = line.role === 'hero' ? 132 : line.role === 'semi' ? 106 : 92;
    return { width: estimateGlyphWidth(glyph.char, size), height: size, advance: estimateGlyphWidth(glyph.char, size) };
  }

  function normalizeMetric(rawMetric, glyph, line) {
    const fallback = defaultMeasure(glyph, line);
    const source = rawMetric && typeof rawMetric === 'object' ? rawMetric : {};
    const width = Math.max(1, finite(source.width, fallback.width));
    const advance = Math.max(width, finite(source.advance, width));
    const height = Math.max(1, finite(source.height, fallback.height));
    return { ...source, width, advance, height };
  }

  function splitMeasuredToken(token, measuredGlyphs, maxWidth) {
    const fragments = [];
    let current = [];
    let width = 0;
    measuredGlyphs.forEach(item => {
      const advance = Math.max(1, finite(item.metric.advance, item.metric.width));
      if (current.length && width + advance > maxWidth) {
        fragments.push({ measuredGlyphs: current, width });
        current = [];
        width = 0;
      }
      // A single glyph may itself exceed maxWidth; it remains intact because
      // splitting inside a grapheme would corrupt the rendered character.
      current.push(item);
      width += advance;
    });
    if (current.length) fragments.push({ measuredGlyphs: current, width });
    return fragments.map((fragment, fragmentIndex) => ({
      token,
      measuredGlyphs: fragment.measuredGlyphs,
      width: fragment.width,
      fragmentIndex,
      fragmentCount: fragments.length,
    }));
  }

  function layoutLines(lines, options = {}) {
    const maxWidth = Math.max(280, finite(options.maxWidth, 1480));
    const rowGap = Math.max(10, finite(options.rowGap, 28));
    const lineGap = Math.max(40, finite(options.lineGap, 180));
    const measure = typeof options.measureGlyph === 'function' ? options.measureGlyph : defaultMeasure;
    let cursorY = 0;
    const placements = [];
    lines.forEach(line => {
      const size = line.role === 'hero' ? 132 : line.role === 'semi' ? 106 : 92;
      const rows = [];
      let row = { items: [], width: 0, height: size };
      line.tokens.forEach(token => {
        const measuredGlyphs = token.glyphs.map(glyph => ({
          glyph,
          metric: normalizeMetric(measure(glyph, { ...line, role: token.role }), glyph, { ...line, role: token.role }),
        }));
        splitMeasuredToken(token, measuredGlyphs, maxWidth).forEach(fragment => {
          const gap = fragment.fragmentIndex === 0 && row.items.length ? size * .16 : 0;
          if (row.items.length && row.width + gap + fragment.width > maxWidth) {
            rows.push(row);
            row = { items: [], width: 0, height: size };
          }
          const rowGap = row.items.length ? gap : 0;
          row.items.push({ ...fragment, gap: rowGap });
          row.width += rowGap + fragment.width;
          row.height = Math.max(row.height, ...fragment.measuredGlyphs.map(item => item.metric.height));
        });
      });
      if (row.items.length) rows.push(row);
      const blockHeight = rows.reduce((sum, current) => sum + current.height, 0) + Math.max(0, rows.length - 1) * rowGap;
      const top = cursorY;
      let rowTop = top;
      rows.forEach((current, rowIndex) => {
        let x = -current.width / 2;
        const y = rowTop + current.height / 2;
        current.items.forEach(item => {
          x += item.gap;
          item.measuredGlyphs.forEach(({ glyph, metric }) => {
            const width = Math.max(1, finite(metric.width, metric.advance));
            const advance = Math.max(width, finite(metric.advance, width));
            const seed = hash(`${line.text}|${glyph.sequenceIndex}`);
            const offsetY = ((seed % 7) - 3) * size * .018;
            const placement = {
              glyphId: glyph.id,
              lineIndex: line.lineIndex,
              wordIndex: glyph.wordIndex,
              charIndex: glyph.charIndex,
              readingIndex: glyph.sequenceIndex,
              x: x + width / 2,
              y: y + offsetY,
              width,
              height: Math.max(1, finite(metric.height, size)),
              rowIndex,
              template: line.template,
            };
            glyph.layout = placement;
            placements.push(placement);
            x += advance;
          });
        });
        rowTop += current.height + rowGap;
      });
      line.layout = {
        width: Math.max(...rows.map(rowItem => rowItem.width), 0),
        height: blockHeight,
        rows: rows.length,
        centerX: 0,
        centerY: top + blockHeight / 2,
        maxWidth,
      };
      cursorY += blockHeight + lineGap;
    });
    const resolved = typeof options.resolveCollisions === 'function'
      ? options.resolveCollisions({ placements, lines, maxWidth, rowGap, lineGap })
      : null;
    return {
      placements: Array.isArray(resolved) ? resolved : placements,
      height: Math.max(0, cursorY - lineGap),
      collision: {
        resolverProvided: typeof options.resolveCollisions === 'function',
        policy: 'measure-then-pack; renderer may run a global-fit resolver here',
      },
    };
  }

  function audit(song, lines, glyphs, hardClears, shots) {
    const issues = [];
    lines.forEach(line => {
      const expectedText = graphemes(line.text).join('');
      const actualText = line.glyphs.map(glyph => glyph.char).join('');
      if (expectedText !== actualText) {
        issues.push({
          type: 'line-text-mismatch',
          lineIndex: line.lineIndex,
          expected: expectedText,
          actual: actualText,
        });
      }
      const lineEndMs = line.time + line.duration;
      const glyphStartMs = line.glyphs.reduce((start, glyph) => Math.min(start, glyph.enterAtMs), line.time);
      if (glyphStartMs < line.time - 1) {
        issues.push({ type: 'line-start-mismatch', lineIndex: line.lineIndex,
          lineStartMs: line.time, glyphStartMs });
      }
      const glyphEndMs = line.glyphs.reduce((end, glyph) => Math.max(end, glyph.intervalEndMs), line.time);
      if (glyphEndMs > lineEndMs + 1) {
        issues.push({
          type: 'line-duration-underrun',
          lineIndex: line.lineIndex,
          lineEndMs,
          glyphEndMs,
          overrunMs: glyphEndMs - lineEndMs,
        });
      }
    });
    const sourceOrder = glyphs;
    for (let index = 1; index < sourceOrder.length; index += 1) {
      if (sourceOrder[index].enterAtMs < sourceOrder[index - 1].enterAtMs - .001) {
        issues.push({ type: 'source-time-order', previous: sourceOrder[index - 1].id, current: sourceOrder[index].id });
      }
    }
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].time < lines[index - 1].time - .001) {
        issues.push({ type: 'line-time-order', previous: lines[index - 1].lineIndex, current: lines[index].lineIndex });
      }
    }
    const order = glyphs.slice().sort((a, b) => a.enterAtMs - b.enterAtMs
      || a.lineIndex - b.lineIndex || a.wordIndex - b.wordIndex || a.charIndex - b.charIndex);
    for (let index = 1; index < order.length; index += 1) {
      const previous = order[index - 1];
      const current = order[index];
      if (current.enterAtMs < previous.enterAtMs - .001) issues.push({ type: 'time-order', previous: previous.id, current: current.id });
    }
    lines.forEach(line => {
      line.glyphs.forEach((glyph, index) => {
        if (index && glyph.enterAtMs < line.glyphs[index - 1].enterAtMs - .001) {
          issues.push({ type: 'line-read-order', lineIndex: line.lineIndex, glyph: glyph.id });
        }
      });
    });
    const measured = lines.flatMap(line => line.glyphs).filter(glyph => glyph.layout);
    for (let index = 1; index < measured.length; index += 1) {
      if (measured[index].lineIndex === measured[index - 1].lineIndex
        && measured[index].layout.rowIndex === measured[index - 1].layout.rowIndex
        && measured[index].layout.x <= measured[index - 1].layout.x) {
        issues.push({ type: 'layout-read-order', previous: measured[index - 1].id, current: measured[index].id });
      }
    }
    return {
      valid: issues.length === 0,
      issues,
      lineCount: lines.length,
      tokenCount: lines.reduce((sum, line) => sum + line.tokens.length, 0),
      sourceTokenCount: lines.reduce((sum, line) => sum + (line.sourceTokens || line.tokens).length, 0),
      graphemeCount: glyphs.length,
      hardClearCount: hardClears.length,
      shotCount: shots.length,
      totalMs: song.totalMs,
    };
  }

  function compile(input, options = {}) {
    const song = normalizeSong(input, options);
    const expanded = expandGlyphTimeline(song);
    const initialLines = classifyLines(expanded.lines, expanded.glyphs);
    const gaps = initialLines.slice(1).map((line, index) => Math.max(0, line.time - (initialLines[index].time + initialLines[index].duration)));
    const threshold = robustGapThreshold(gaps, options);
    const hardClears = [];
    initialLines.slice(1).forEach((line, index) => {
      const previous = initialLines[index];
      const gap = line.time - (previous.time + previous.duration);
      if (gap >= threshold) hardClears.push([previous.time + previous.duration, line.time]);
    });
    const shots = makeShots(initialLines, hardClears, options);
    const laidOut = layoutLines(initialLines, options);
    const result = {
      version: VERSION,
      song,
      lines: initialLines,
      glyphs: expanded.glyphs,
      shots,
      hardClears,
      layout: laidOut,
      metadata: {
        timeUnit: 'ms',
        wordStartMode: options.wordStartMode || 'relative',
        hardClearThresholdMs: threshold,
        maxShotLines: Math.min(4, finite(options.maxShotLines, 4)),
        maxShotSpanMs: Math.min(6000, finite(options.maxShotSpanMs, 6000)),
        collisionPolicy: 'measure-then-pack; later glyphs shift forward; renderer may replace with global-fit',
        random: false,
      },
    };
    result.audit = audit(song, result.lines, result.glyphs, hardClears, shots);
    result.debug = {
      order: result.glyphs.map(glyph => ({ id: glyph.id, char: glyph.char, lineIndex: glyph.lineIndex, wordIndex: glyph.wordIndex, charIndex: glyph.charIndex, enterAtMs: glyph.enterAtMs })),
      roles: result.lines.map(line => ({ lineIndex: line.lineIndex, role: line.role, mode: line.template.mode })),
      hardClears: hardClears.map(range => range.slice()),
      shots: shots.map(shot => ({ id: shot.id, lines: shot.lines.slice(), startMs: shot.startMs, endMs: shot.endMs })),
    };
    return result;
  }

  const api = {
    VERSION,
    graphemes,
    normalizeSong,
    compile,
    layout(songOrCompiled, options = {}) {
      const compiled = songOrCompiled && songOrCompiled.version === VERSION
        ? songOrCompiled : compile(songOrCompiled, options);
      compiled.layout = layoutLines(compiled.lines, options);
      compiled.audit = audit(compiled.song, compiled.lines, compiled.glyphs, compiled.hardClears, compiled.shots);
      return compiled;
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.LyricStageGenericLayoutCoreV10 = api;
})();

/*
 * Elitesand Pro — original camera demo's per-glyph effects.
 *
 * This file deliberately has no DOM, canvas lookup, or application state. It
 * is usable from CommonJS tests and from a browser script tag. Layout/camera
 * code owns the surrounding transform; this module owns glyph motion, paint,
 * colour, and conservative paint bounds.
 */
(() => {
  'use strict';

  const VERSION = '1.1.0-no-lock-selector';
  const MOTIONS = Object.freeze([
    'slam', 'scatter', 'stamp', 'cascade', 'trace', 'drop', 'tower',
    'sweep', 'ribbon', 'burst', 'stretch', 'hinge', 'close', 'lock',
  ]);
  const MOTION_TIMING = Object.freeze({
    slam: [.055, .46], scatter: [.090, .52], stamp: [.020, .25], cascade: [.120, .42],
    trace: [.130, .50], drop: [.100, .48], tower: [.145, .54], sweep: [.070, .40],
    ribbon: [.055, .44], burst: [.035, .48], stretch: [.090, .46], hinge: [.120, .55],
    close: [.070, .60], lock: [.120, .42],
  });
  const MOTION_INDEX = Object.freeze(Object.fromEntries(MOTIONS.map((name, index) => [name, index])));
  const IMPACT_MOTIONS = new Set(['slam', 'stamp', 'drop', 'tower', 'burst', 'hinge', 'close', 'lock']);

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (from, to, progress) => from + (to - from) * progress;
  const smooth = value => {
    const x = clamp(value);
    return x * x * (3 - 2 * x);
  };
  const map = (value, from, to) => clamp((value - from) / Math.max(.0001, to - from));
  const easeOut = value => 1 - Math.pow(1 - clamp(value), 3);
  // Keep this exactly in step with camera-demo-v3-original.js.
  const easeBack = value => {
    const x = clamp(value);
    const c1 = 1.45;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  const fract = value => value - Math.floor(value);

  // Only presentation metadata is accepted here. In particular, text, char,
  // x, y, start, and other lyric/coordinate fields are intentionally not read,
  // so selection cannot depend on lyric content or a world position.
  function metadataHash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function normalizeMotionIndex(value) {
    const numeric = Math.floor(finite(value, 0));
    const wrapped = numeric % MOTIONS.length;
    return wrapped < 0 ? wrapped + MOTIONS.length : wrapped;
  }

  function palette(ink = 'dark') {
    if (ink === 'light') {
      return {
        fill: '#fffaf0', edge: 'rgba(7,10,15,.96)', shadow: 'rgba(0,0,0,.76)',
        cyan: '#00d8e6', red: '#ff315c', ghost: 'rgba(255,250,240,.88)', micro: '#fffaf0',
      };
    }
    return {
      fill: '#0c0e12', edge: 'rgba(255,255,255,.96)', shadow: 'rgba(255,255,255,.60)',
      cyan: '#00bfd3', red: '#ed3153', ghost: 'rgba(12,14,18,.82)', micro: '#0c0e12',
    };
  }

  function chooseMotion(context = {}) {
    const role = String(context.role || 'support').toLowerCase();
    const orientation = String(context.orientation || (context.vertical ? 'vertical' : 'horizontal')).toLowerCase();
    const density = clamp(finite(context.density, .5));
    const densityBand = Math.round(density * 13);
    // The host may already own a stable structural seed. Treat it as the
    // ordinal only when no explicit motion index was supplied, so production
    // callers receive the same breadth that the standalone effect demo has.
    const ordinal = normalizeMotionIndex(
      context.motionIndex ?? context.index ?? context.ordinal ?? context.seed ?? 0
    );
    const roleOrder = role === 'hero'
      ? ['slam', 'burst', 'tower', 'scatter', 'hinge', 'close', 'drop', 'sweep', 'ribbon', 'cascade', 'trace', 'stamp', 'stretch']
      : role === 'semi'
        ? ['sweep', 'drop', 'ribbon', 'cascade', 'stretch', 'slam', 'tower', 'scatter', 'burst', 'hinge', 'close', 'trace', 'stamp']
        : ['trace', 'cascade', 'stamp', 'ribbon', 'drop', 'sweep', 'stretch', 'slam', 'scatter', 'tower', 'burst', 'hinge', 'close'];
    const orientationBand = orientation.startsWith('vert') ? 3 : orientation.startsWith('diag') ? 7 : 0;
    const bucket = metadataHash(`${role}|${orientation}|${densityBand}|${ordinal}`);
    return roleOrder[(bucket + orientationBand + densityBand + ordinal) % roleOrder.length];
  }

  function sample(input = {}) {
    const motion = MOTIONS.includes(input.motion) ? input.motion : 'slam';
    const index = Math.max(0, Math.floor(finite(input.index, 0)));
    const p = clamp(finite(input.progress, 0));
    const e = easeOut(p);
    const b = easeBack(p);
    const inv = 1 - e;
    const sign = finite(input.sign, index % 2 ? -1 : 1) < 0 ? -1 : 1;
    const angle = finite(input.angle, finite(input.start, 0) * 1.73 + index * 2.21);
    const reducedMotion = Boolean(input.reducedMotion);
    const amplitude = Math.max(0, finite(input.amplitude, 1));
    const visual = {
      dx: 0, dy: 0, rot: 0, rotation: 0, scaleX: 1, scaleY: 1,
      alpha: .14 + .86 * e, fill: 1, outline: 1, register: 1,
      echo: 0, echoX: 0, echoY: 0,
    };

    if (motion === 'slam') {
      visual.dx = sign * (118 + index * 16) * inv;
      visual.dy = 58 * inv;
      visual.rot = sign * .115 * inv;
      visual.scaleX = visual.scaleY = .38 + .62 * b;
      visual.echo = .23 * inv;
    } else if (motion === 'scatter') {
      visual.dx = Math.cos(angle) * 185 * inv;
      visual.dy = Math.sin(angle) * 128 * inv;
      visual.rot = Math.sin(angle) * .22 * inv;
      visual.scaleX = visual.scaleY = .50 + .50 * b;
      visual.echo = .18 * inv;
    } else if (motion === 'stamp') {
      visual.scaleX = visual.scaleY = .16 + .84 * b;
      visual.rot = sign * .055 * inv;
      visual.echo = .28 * inv;
    } else if (motion === 'cascade') {
      visual.dx = sign * (42 + index * 9) * inv;
      visual.dy = (index % 3 - 1) * 104 * inv;
      visual.rot = sign * .10 * inv;
      visual.scaleX = visual.scaleY = .68 + .32 * e;
    } else if (motion === 'trace') {
      visual.dx = sign * 24 * inv;
      visual.dy = 20 * inv;
      visual.scaleX = visual.scaleY = .92 + .08 * e;
      visual.fill = smooth(map(p, .42, 1));
      visual.register = smooth(map(p, .22, .88));
      visual.alpha = .32 + .68 * e;
    } else if (motion === 'drop') {
      visual.dx = sign * 24 * inv;
      visual.dy = -178 * inv;
      visual.rot = sign * .075 * inv;
      visual.scaleX = .76 + .24 * e;
      visual.scaleY = 1.32 - .32 * e;
      visual.echo = .16 * inv;
    } else if (motion === 'tower') {
      visual.dx = sign * 64 * inv;
      visual.dy = sign * (210 + index * 24) * inv;
      visual.rot = -sign * .13 * inv;
      visual.scaleX = .58 + .42 * e;
      visual.scaleY = .82 + .18 * b;
      visual.echo = .14 * inv;
    } else if (motion === 'sweep') {
      const rotationBase = finite(input.rotationBase, finite(input.rot, 0));
      visual.dx = rotationBase <= 0 ? -190 * inv : 190 * inv;
      visual.dy = sign * 18 * inv;
      visual.rot = sign * .035 * inv;
      visual.scaleX = .62 + .38 * e;
      visual.echo = .12 * inv;
    } else if (motion === 'ribbon') {
      visual.dx = -215 * inv;
      visual.dy = Math.sin(index * 1.7) * 44 * inv;
      visual.rot = sign * .07 * inv;
      visual.scaleX = .48 + .52 * e;
      visual.scaleY = 1.14 - .14 * e;
    } else if (motion === 'burst') {
      visual.dx = Math.cos(angle) * 230 * inv;
      visual.dy = Math.sin(angle) * 170 * inv;
      visual.rot = sign * .18 * inv;
      visual.scaleX = visual.scaleY = .24 + .76 * b;
      visual.echo = .30 * inv;
    } else if (motion === 'stretch') {
      visual.dx = sign * 84 * inv;
      visual.scaleX = .28 + .72 * e;
      visual.scaleY = 1.28 - .28 * e;
      visual.fill = smooth(map(p, .18, .82));
    } else if (motion === 'hinge') {
      visual.dx = sign * 76 * inv;
      visual.dy = 88 * inv;
      visual.rot = sign * .30 * inv;
      visual.scaleX = .62 + .38 * b;
      visual.scaleY = .78 + .22 * e;
      visual.echo = .16 * inv;
    } else if (motion === 'close') {
      visual.dx = sign * (150 + index * 28) * inv;
      visual.dy = -70 * inv;
      visual.rot = sign * .16 * inv;
      visual.scaleX = visual.scaleY = .18 + .82 * b;
      visual.echo = .32 * inv;
    } else if (motion === 'lock') {
      const latch = smooth(map(p, .46, .82));
      visual.dx = sign * 52 * (1 - latch);
      visual.scaleX = .72 + .28 * latch;
      visual.scaleY = 1.18 - .18 * latch;
      visual.fill = latch;
      visual.register = 1 - latch * .35;
      visual.alpha = .28 + .72 * Math.max(e, latch);
    }

    if (!reducedMotion && IMPACT_MOTIONS.has(motion)) {
      const age = Math.max(0, finite(input.age, 0));
      const ring = Math.sin(age * 20) * Math.exp(-age * 5.2);
      visual.scaleX *= 1 + ring * .036;
      visual.scaleY *= 1 - ring * .024;
    }

    // The original's reduced-motion branch has no travel/rotation/echo.
    if (reducedMotion) {
      visual.dx = 0;
      visual.dy = 0;
      visual.rot = 0;
      visual.scaleX = 1;
      visual.scaleY = 1;
      visual.alpha = smooth(p);
      visual.fill = 1;
      visual.outline = 1;
      visual.register = .45;
      visual.echo = 0;
      visual.echoX = 0;
      visual.echoY = 0;
    }

    visual.dx *= amplitude;
    visual.dy *= amplitude;
    visual.rot *= amplitude;
    visual.rotation = visual.rot;
    if (!reducedMotion) {
      visual.echoX = -visual.dx * .24 + sign * 8;
      visual.echoY = -visual.dy * .18 + 8;
    }
    visual.fontSize = Math.max(1, finite(input.fontSize, 100));
    return visual;
  }

  function effectPadding(input = {}) {
    const fontSize = Math.max(1, finite(input.fontSize, 100));
    const hero = input.role === 'hero';
    const visual = input.visual || {};
    const offset = hero ? Math.max(5, fontSize * .022) : Math.max(2.5, fontSize * .015);
    const stroke = Math.max(2.2, fontSize * (hero ? .026 : .020)) / 2;
    const shadowBlur = hero ? Math.max(4, fontSize * .026) : Math.max(2, fontSize * .016);
    const shadowX = hero ? 3 : 1.5;
    const shadowY = hero ? 5 : 2;
    const echo = Math.max(0, finite(visual.echo, 0));
    const echoX = Math.abs(finite(visual.echoX, 0));
    const echoY = Math.abs(finite(visual.echoY, 0));
    const echoStroke = Math.max(1.4, fontSize * .010) / 2;
    const motionX = Math.abs(finite(visual.dx, 0));
    const motionY = Math.abs(finite(visual.dy, 0));
    const bodyX = stroke + shadowBlur + Math.abs(shadowX);
    const bodyY = stroke + shadowBlur + Math.abs(shadowY);
    const registerX = offset;
    const registerY = offset * .20;
    const echoPadX = echo > .001 ? Math.max(echoX, echoX * 1.72) + echoStroke : 0;
    const echoPadY = echo > .001 ? Math.max(echoY, echoY * 1.72) + echoStroke : 0;
    const fullX = motionX + Math.max(bodyX, registerX, echoPadX);
    const fullY = motionY + Math.max(bodyY, registerY, echoPadY);
    return {
      left: fullX, right: fullX, top: fullY, bottom: fullY, x: fullX, y: fullY,
      body: { left: motionX + bodyX, right: motionX + bodyX, top: motionY + bodyY, bottom: motionY + bodyY },
      register: { left: motionX + registerX, right: motionX + registerX, top: motionY + registerY, bottom: motionY + registerY },
      echo: { left: motionX + echoPadX, right: motionX + echoPadX, top: motionY + echoPadY, bottom: motionY + echoPadY },
    };
  }

  function estimateWidth(char, fontSize) {
    return /^[\u0000-\u00ff]$/u.test(String(char || '')) ? fontSize * .58 : fontSize * .98;
  }

  function rectFromInk(input, fontSize) {
    const supplied = input.inkRect && typeof input.inkRect === 'object' ? input.inkRect : null;
    const fallbackWidth = Math.max(1, finite(input.width, estimateWidth(input.char, fontSize)));
    const fallbackHeight = Math.max(1, finite(input.height, fontSize * 1.06));
    const left = supplied && Number.isFinite(Number(supplied.left)) ? Number(supplied.left)
      : supplied && Number.isFinite(Number(supplied.actualBoundingBoxLeft)) ? -Number(supplied.actualBoundingBoxLeft)
      : supplied && Number.isFinite(Number(supplied.x)) ? Number(supplied.x)
        : -fallbackWidth / 2;
    const top = supplied && Number.isFinite(Number(supplied.top)) ? Number(supplied.top)
      : supplied && Number.isFinite(Number(supplied.actualBoundingBoxAscent)) ? -Number(supplied.actualBoundingBoxAscent)
      : supplied && Number.isFinite(Number(supplied.y)) ? Number(supplied.y)
        : -fallbackHeight / 2;
    const right = supplied && Number.isFinite(Number(supplied.right)) ? Number(supplied.right)
      : supplied && Number.isFinite(Number(supplied.actualBoundingBoxRight)) ? Number(supplied.actualBoundingBoxRight)
        : left + Math.max(1, supplied && Number.isFinite(Number(supplied.width)) ? Number(supplied.width) : fallbackWidth);
    const bottom = supplied && Number.isFinite(Number(supplied.bottom)) ? Number(supplied.bottom)
      : supplied && Number.isFinite(Number(supplied.actualBoundingBoxDescent)) ? Number(supplied.actualBoundingBoxDescent)
        : top + Math.max(1, supplied && Number.isFinite(Number(supplied.height)) ? Number(supplied.height) : fallbackHeight);
    return { left, right: Math.max(left + 1, right), top, bottom: Math.max(top + 1, bottom) };
  }

  function unionRects(rects) {
    const valid = rects.filter(Boolean);
    const left = Math.min(...valid.map(rect => rect.left));
    const right = Math.max(...valid.map(rect => rect.right));
    const top = Math.min(...valid.map(rect => rect.top));
    const bottom = Math.max(...valid.map(rect => rect.bottom));
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  function transformRect(rect, input) {
    const visual = input.visual || {};
    const sx = finite(visual.scaleX, 1);
    const sy = finite(visual.scaleY, 1);
    const rotation = finite(visual.rotation, finite(visual.rot, 0));
    const tx = finite(input.x, 0) + finite(visual.dx, 0);
    const ty = finite(input.y, 0) + finite(visual.dy, 0);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const points = [
      [rect.left, rect.top], [rect.right, rect.top],
      [rect.right, rect.bottom], [rect.left, rect.bottom],
    ].map(([x, y]) => [tx + x * sx * cos - y * sy * sin, ty + x * sx * sin + y * sy * cos]);
    return {
      left: Math.min(...points.map(point => point[0])),
      right: Math.max(...points.map(point => point[0])),
      top: Math.min(...points.map(point => point[1])),
      bottom: Math.max(...points.map(point => point[1])),
    };
  }

  function effectBounds(input = {}) {
    const fontSize = Math.max(1, finite(input.fontSize, 100));
    const ink = rectFromInk(input, fontSize);
    const core = transformRect(ink, input);
    // transformRect already applies visual.dx/dy.  Ask effectPadding for the
    // local paint expansion only, otherwise a displacement would be counted
    // twice in the returned bounds.
    const visual = input.visual && typeof input.visual === 'object' ? input.visual : {};
    const padding = effectPadding({ ...input, visual: { ...visual, dx: 0, dy: 0 } });
    const body = {
      left: core.left - padding.body.left, right: core.right + padding.body.right,
      top: core.top - padding.body.top, bottom: core.bottom + padding.body.bottom,
    };
    const register = {
      left: core.left - padding.register.left, right: core.right + padding.register.right,
      top: core.top - padding.register.top, bottom: core.bottom + padding.register.bottom,
    };
    const echo = {
      left: core.left - padding.echo.left, right: core.right + padding.echo.right,
      top: core.top - padding.echo.top, bottom: core.bottom + padding.echo.bottom,
    };
    const full = unionRects([body, register, echo]);
    return {
      left: full.left, right: full.right, top: full.top, bottom: full.bottom,
      width: full.width, height: full.height,
      ink: { ...core, width: core.right - core.left, height: core.bottom - core.top },
      body: { ...body, width: body.right - body.left, height: body.bottom - body.top },
      register: { ...register, width: register.right - register.left, height: register.bottom - register.top },
      echo: { ...echo, width: echo.right - echo.left, height: echo.bottom - echo.top },
      full,
      fullEffect: full,
      union: full,
      padding,
    };
  }

  function drawGlyph(ctx, input = {}) {
    if (!ctx || typeof ctx.fillText !== 'function' || typeof ctx.strokeText !== 'function') return false;
    const char = String(input.char == null ? '' : input.char);
    if (!char) return false;
    const fontSize = Math.max(1, finite(input.fontSize, 100));
    const weight = input.weight == null ? 950 : input.weight;
    const font = input.font || 'sans-serif';
    const role = input.role || 'support';
    const visual = input.visual && typeof input.visual === 'object' ? input.visual : {};
    const pal = input.palette || input.pal || palette(input.ink || 'dark');
    const alpha = clamp(finite(input.alpha, 1));
    const memory = clamp(finite(input.memory, 0));
    const settled = clamp(finite(input.settled, finite(visual.settled, 0)));
    const x = finite(input.x, 0);
    const y = finite(input.y, 0);
    const hero = role === 'hero';
    const offset = hero ? Math.max(5, fontSize * .022) : Math.max(2.5, fontSize * .015);
    const registerStrength = lerp(1, .42, settled);
    const edgeStrength = lerp(1, .74, settled);
    const shadowStrength = lerp(1, .65, settled);
    const fillStrength = finite(visual.fill, 1);
    const outlineStrength = finite(visual.outline, 1);
    const colorStrength = finite(visual.register, 1);
    const save = typeof ctx.save === 'function';
    if (save) ctx.save();
    ctx.font = `${weight} ${fontSize}px ${font}`;
    // Preserve the standalone demo's left/top default, while allowing a host
    // that positions glyph centers to keep paint and measured bounds aligned.
    ctx.textAlign = input.textAlign || 'start';
    ctx.textBaseline = input.textBaseline || 'top';
    ctx.lineJoin = 'round';

    if (finite(visual.echo, 0) > .001) {
      ctx.globalAlpha = alpha * finite(visual.echo, 0);
      ctx.lineWidth = Math.max(1.4, fontSize * .010);
      ctx.strokeStyle = pal.edge;
      ctx.strokeText(char, x + finite(visual.echoX, 0), y + finite(visual.echoY, 0));
      ctx.globalAlpha *= .46;
      ctx.strokeText(char, x + finite(visual.echoX, 0) * 1.72, y + finite(visual.echoY, 0) * 1.72);
    }

    ctx.globalAlpha = alpha * (hero ? .82 : .58) * registerStrength * colorStrength * (1 - memory);
    ctx.fillStyle = pal.cyan;
    ctx.fillText(char, x - offset, y + offset * .20);
    ctx.fillStyle = pal.red;
    ctx.fillText(char, x + offset, y - offset * .16);

    ctx.globalAlpha = alpha * outlineStrength * lerp(1, .48, memory);
    ctx.lineWidth = Math.max(2.2, fontSize * (hero ? .026 : .020) * edgeStrength);
    ctx.strokeStyle = pal.edge;
    ctx.shadowColor = pal.shadow;
    ctx.shadowBlur = (hero ? Math.max(4, fontSize * .026) : Math.max(2, fontSize * .016)) * shadowStrength;
    ctx.shadowOffsetX = hero ? 3 : 1.5;
    ctx.shadowOffsetY = hero ? 5 : 2;
    ctx.strokeText(char, x, y);
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = alpha * fillStrength * (1 - memory);
    ctx.fillStyle = role === 'micro' ? pal.micro : pal.fill;
    ctx.fillText(char, x, y);
    if (save) ctx.restore();
    return true;
  }

  const api = {
    VERSION,
    MOTIONS,
    MOTION_INDEX,
    MOTION_TIMING,
    chooseMotion,
    normalizeMotionIndex,
    sample,
    palette,
    drawGlyph,
    effectPadding,
    effectBounds,
    paintBounds: effectBounds,
    visualBounds: effectBounds,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LyricStageOriginalGlyphFx = api;
  if (typeof globalThis !== 'undefined') globalThis.LyricStageOriginalGlyphFx = api;
})();


(() => {
  'use strict';

  const core = globalThis.LyricStageGenericLayoutCoreV10;
  const glyphFx = globalThis.LyricStageOriginalGlyphFx;
  if (!core || typeof core.compile !== 'function' || !glyphFx || typeof glyphFx.sample !== 'function') {
    console.warn('[Wordscape] 排版或逐字效果核心未載入');
    return;
  }

  const DESIGN_W = 1920;
  const DESIGN_H = 1080;
  const SAFE_W = 1640;
  const SAFE_H = 820;
  const DEFAULT_FONT = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif';
  const CROSS_OFFSETS = [0, -.052, .032, -.024, .048, -.034];
  const ROTATION_DEGREES = [-.22, .12, -.08, .18, 0, .08];
  const SCALE_VARIANTS = [1, .985, 1.025, .995, 1.035, .99];
  const COMPILE_OPTIONS = Object.freeze({
    hardClearMinMs: 4200,
    maxShotLines: 4,
    maxShotSpanMs: 6000,
    shotGapMs: 1400,
  });

  let rootEl = null;
  let canvas = null;
  let ctx = null;
  let resizeObserver = null;
  let lastTemplateContext = null;
  let compiled = null;
  let TOTAL = 0;
  let FIRST_LYRIC_AT = 0;
  let FONT = DEFAULT_FONT;
  let reduceMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  let settingsSignature = '';
  let lifecycleGeneration = 0;

  const state = {
    time: 0,
    ink: 'dark',
    dpr: 1,
  };
  const runtimeSettings = {
    fontWeight: 900,
    typeScale: 1,
    motionScale: 1,
    cameraScale: 1,
    breathScale: 1,
    color: '#0c0e12',
    activeColor: '#ed3153',
  };

  const worldShots = [];
  const worldLines = [];
  const worldGlyphs = [];
  const worldTokens = [];
  const takes = [];
  const cameraKeys = [];
  const cameraTables = new Map();
  const shotFadeWindows = new Map();

  function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function cssValue(name, fallback = '') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function normalizeColor(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function perceivedLight(value) {
    const match = String(value || '').trim().match(/^#([0-9a-f]{6})$/i);
    if (!match) return /(?:white|ivory|snow|#fff\b|255\s*,\s*255\s*,\s*255)/i.test(String(value || ''));
    const number = Number.parseInt(match[1], 16);
    const red = (number >> 16) & 255;
    const green = (number >> 8) & 255;
    const blue = number & 255;
    return red * .2126 + green * .7152 + blue * .0722 > 168;
  }

  function paletteForSettings() {
    const base = glyphFx.palette(state.ink);
    return {
      ...base,
      fill: runtimeSettings.color,
      micro: runtimeSettings.color,
      red: runtimeSettings.activeColor,
    };
  }

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (from, to, progress) => from + (to - from) * progress;
  const quintic = value => {
    const progress = clamp(value);
    return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
  };
  const hash = value => {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  };
  const signed = value => ((hash(value) & 0xffff) / 0x7fff) - 1;
  const hasCjk = value => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value);

  function frame() {
    if (!canvas) return { width: 0, height: 0 };
    return { width: canvas.clientWidth || rootEl?.clientWidth || 0, height: canvas.clientHeight || rootEl?.clientHeight || 0 };
  }

  function resize() {
    if (!canvas || !ctx) return;
    const box = canvas.getBoundingClientRect();
    state.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(box.width * state.dpr));
    const height = Math.max(1, Math.round(box.height * state.dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function glyphMetrics(char, fontSize, weight) {
    ctx.font = `${weight} ${fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const measured = ctx.measureText(char);
    const advance = Math.max(fontSize * (/^[A-Za-z0-9]$/u.test(char) ? .28 : .46), measured.width);
    const actual = [measured.actualBoundingBoxLeft, measured.actualBoundingBoxRight,
      measured.actualBoundingBoxAscent, measured.actualBoundingBoxDescent];
    const ink = actual.every(Number.isFinite) && actual[0] + actual[1] > 0 && actual[2] + actual[3] > 0
      ? { left: -actual[0], right: actual[1], top: -actual[2], bottom: actual[3] }
      : { left: -advance / 2, right: advance / 2, top: -fontSize * .52, bottom: fontSize * .52 };
    return { advance, ink };
  }

  function selectShotMode(shot, shotIndex, previousMode) {
    const lines = shot.lines.map(index => compiled.lines[index]);
    const tokens = lines.flatMap(line => line.tokens);
    const glyphCount = tokens.reduce((sum, token) => sum + token.glyphs.length, 0);
    const density = glyphCount / Math.max(.35, shot.spanMs / 1000);
    const cjkRatio = tokens.length
      ? tokens.filter(token => hasCjk(token.text)).length / tokens.length
      : 0;
    let choices;
    if (shot.lineCount > 1 || density > 5.8) choices = ['grid', 'grid', 'stair'];
    else if (tokens.length <= 3) choices = ['quiet', 'arc'];
    // A tall column is only legible for a genuinely short phrase. Letting a
    // 12–14 glyph line enter this mode makes the whole poster fit by shrinking
    // every support word, even though collision/viewport audits remain green.
    else if (cjkRatio > .7 && tokens.length <= 6 && glyphCount <= 10) choices = ['column', 'stair', 'arc'];
    else choices = ['ribbon', 'arc', 'stair', 'grid'];
    const seed = hash(`${compiled.song.title}|${shot.startMs}|${tokens.map(token => token.text).join('|')}`);
    let mode = choices[seed % choices.length];
    if (mode === previousMode && choices.some(choice => choice !== previousMode)) {
      mode = choices[(seed + 1) % choices.length];
    }
    return mode;
  }

  function shotBaseSize(shot, tokens) {
    const glyphCount = tokens.reduce((sum, token) => sum + token.glyphs.length, 0);
    const density = glyphCount / Math.max(.5, shot.spanMs / 1000);
    const crowded = Math.max(0, glyphCount - 11) * 1.45 + Math.max(0, density - 3.4) * 3.2;
    return clamp((88 - crowded) * runtimeSettings.typeScale, 54 * runtimeSettings.typeScale, 88 * runtimeSettings.typeScale);
  }

  function roleScale(role, token, mode) {
    const length = token.glyphs.length;
    if (role === 'hero') {
      const longPenalty = Math.max(0, length - 4) * .17;
      return clamp((mode === 'quiet' ? 3.65 : 3.2) - longPenalty, 2.15, 3.7);
    }
    if (role === 'semi') return clamp(2.05 - Math.max(0, length - 5) * .08, 1.55, 2.08);
    return 1;
  }

  function shouldBeVertical(token, mode, tokenIndex) {
    if (!hasCjk(token.text) || token.glyphs.length > 5) return false;
    if (mode === 'column') return token.role !== 'support' || tokenIndex % 3 === 0;
    if (mode === 'stair' && token.role === 'hero') return hash(`${token.text}|vertical`) % 3 !== 0;
    if (mode === 'grid') return token.role === 'hero' && (hash(`${token.text}|vertical`) % 4 === 0);
    // In an airy single-line poster, an early CJK semi-anchor supplies the
    // vertical spine while a later hero (often a longer Latin or CJK token)
    // remains free to expand horizontally. This is structural role grammar,
    // not a lyric-string or fixed-coordinate exception.
    if ((mode === 'arc' || mode === 'quiet' || mode === 'ribbon' || mode === 'stair') && token.role === 'semi'
      && tokenIndex > 0 && tokenIndex <= 2 && token.glyphs.length >= 2) return true;
    return false;
  }

  function measureToken(token, line, mode, baseSize, tokenIndex, fixedFontSize = null) {
    const role = token.role || 'support';
    const finalVariation = SCALE_VARIANTS[(hash(`${line.text}|${token.wordIndex}|scale`) >>> 2) % SCALE_VARIANTS.length];
    const fontSize = fixedFontSize ?? baseSize * roleScale(role, token, mode) * finalVariation;
    const weight = runtimeSettings.fontWeight;
    const vertical = shouldBeVertical(token, mode, tokenIndex);
    const letterGap = fontSize * .19;
    const metrics = token.glyphs.map(glyph => ({
      glyph,
      ...glyphMetrics(glyph.char, fontSize, weight),
    }));
    const horizontalWidth = metrics.reduce((sum, item, index) => (
      sum + item.advance + (index ? letterGap : 0)
    ), 0);
    const verticalAdvance = fontSize * 1.32;
    const width = vertical
      ? Math.max(fontSize, ...metrics.map(item => item.advance))
      : horizontalWidth;
    const height = vertical
      ? Math.max(1, metrics.length) * verticalAdvance
      : fontSize * 1.22;
    return {
      token,
      line,
      role,
      fontSize,
      weight,
      vertical,
      metrics,
      letterGap,
      verticalAdvance,
      width,
      height,
      x: 0,
      y: 0,
      rotation: ROTATION_DEGREES[hash(`${line.text}|${token.wordIndex}|rotation`) % ROTATION_DEGREES.length] * Math.PI / 180,
    };
  }

  function placeHorizontal(boxes, mode, baseSize) {
    const gap = baseSize * (mode === 'quiet' ? .62 : .42);
    let cursor = 0;
    boxes.forEach((box, index) => {
      const cross = CROSS_OFFSETS[index % CROSS_OFFSETS.length] * baseSize * 5.2;
      const arc = mode === 'arc'
        ? Math.sin((index / Math.max(1, boxes.length - 1)) * Math.PI * 1.55 - .3) * baseSize * .72
        : 0;
      const stair = mode === 'stair'
        ? ((index % 4) - 1.5) * baseSize * .34
        : 0;
      box.x = cursor + box.width / 2;
      box.y = cross + arc + stair;
      cursor += box.width + gap;
    });
    const center = cursor > 0 ? (cursor - gap) / 2 : 0;
    boxes.forEach(box => { box.x -= center; });
  }

  function placeColumn(boxes, baseSize) {
    const gap = baseSize * .52;
    let cursor = 0;
    boxes.forEach((box, index) => {
      box.x = CROSS_OFFSETS[index % CROSS_OFFSETS.length] * baseSize * 7.4;
      box.y = cursor + box.height / 2;
      cursor += box.height + gap;
    });
    const center = cursor > 0 ? (cursor - gap) / 2 : 0;
    boxes.forEach(box => { box.y -= center; });
  }

  function placeGrid(boxes, baseSize, targetWidth) {
    const gapX = baseSize * .38;
    const gapY = baseSize * .58;
    const rows = [];
    let row = { boxes: [], width: 0, height: 0, firstLine: boxes[0]?.line.lineIndex ?? 0 };
    boxes.forEach(box => {
      const lineChanged = row.boxes.length && box.line.lineIndex !== row.boxes.at(-1).box.line.lineIndex;
      const needed = (row.boxes.length ? gapX : 0) + box.width;
      const shouldWrap = row.boxes.length && (
        row.width + needed > targetWidth
        || (lineChanged && row.width > targetWidth * .52)
      );
      if (shouldWrap) {
        rows.push(row);
        row = { boxes: [], width: 0, height: 0, firstLine: box.line.lineIndex };
      }
      const lineGap = lineChanged && row.boxes.length ? gapX * 1.8 : 0;
      row.boxes.push({ box, gap: row.boxes.length ? gapX + lineGap : 0 });
      row.width += (row.boxes.length > 1 ? gapX + lineGap : 0) + box.width;
      row.height = Math.max(row.height, box.height);
    });
    if (row.boxes.length) rows.push(row);
    const totalHeight = rows.reduce((sum, item) => sum + item.height, 0) + Math.max(0, rows.length - 1) * gapY;
    let y = -totalHeight / 2;
    rows.forEach((current, rowIndex) => {
      const indent = CROSS_OFFSETS[rowIndex % CROSS_OFFSETS.length] * baseSize * 5;
      let x = -current.width / 2 + indent;
      current.boxes.forEach(({ box, gap }) => {
        x += gap;
        box.x = x + box.width / 2;
        box.y = y + current.height / 2;
        x += box.width;
      });
      y += current.height + gapY;
    });
  }

  function boundsForBoxes(boxes) {
    return boxes.reduce((result, box) => {
      const cosine = Math.abs(Math.cos(box.rotation));
      const sine = Math.abs(Math.sin(box.rotation));
      const width = box.width * cosine + box.height * sine;
      const height = box.width * sine + box.height * cosine;
      return {
        left: Math.min(result.left, box.x - width / 2),
        right: Math.max(result.right, box.x + width / 2),
        top: Math.min(result.top, box.y - height / 2),
        bottom: Math.max(result.bottom, box.y + height / 2),
      };
    }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  }

  function scaleComposition(boxes, factor) {
    boxes.forEach(box => {
      box.x *= factor;
      box.y *= factor;
      box.fontSize *= factor;
      box.width *= factor;
      box.height *= factor;
      box.letterGap *= factor;
      box.verticalAdvance *= factor;
      box.metrics.forEach(metric => {
        metric.advance *= factor;
        for (const key of ['left', 'right', 'top', 'bottom']) metric.ink[key] *= factor;
      });
    });
  }

  function centerComposition(boxes) {
    const bounds = boundsForBoxes(boxes);
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    boxes.forEach(box => {
      box.x -= centerX;
      box.y -= centerY;
    });
    return boundsForBoxes(boxes);
  }

  function buildGlyphsForBox(box, shot) {
    const advances = box.metrics.map(metric => box.vertical ? box.verticalAdvance : metric.advance);
    const total = advances.reduce((sum, advance) => sum + advance, 0)
      + (box.vertical ? 0 : Math.max(0, advances.length - 1) * box.letterGap);
    let cursor = -total / 2;
    const cosine = Math.cos(box.rotation);
    const sine = Math.sin(box.rotation);
    const shotGlyphCount = shot.lines.reduce((sum, lineIndex) => (
      sum + compiled.lines[lineIndex].tokens.reduce((lineSum, token) => lineSum + token.glyphs.length, 0)
    ), 0);
    const motion = glyphFx.chooseMotion({
      role: box.role, vertical: box.vertical,
      density: shotGlyphCount / Math.max(.5, shot.spanMs / 1000),
      seed: hash(`${box.line.text}|${box.token.wordIndex}|${box.token.fragmentIndex || 0}|${box.role}`),
    });
    return box.metrics.map((metric, index) => {
      if (index && !box.vertical) cursor += box.letterGap;
      const advance = advances[index];
      const along = cursor + advance / 2;
      cursor += advance;
      const cross = CROSS_OFFSETS[index % CROSS_OFFSETS.length] * box.fontSize;
      const localX = box.vertical ? cross : along;
      const localY = box.vertical ? along : cross;
      const x = box.x + localX * cosine - localY * sine;
      const y = box.y + localX * sine + localY * cosine;
      const sourceSlot = metric.glyph.sourceSlotMs / 1000;
      const naturalDuration = glyphFx.MOTION_TIMING[motion][1];
      const entryDuration = reduceMotion ? .01 : Math.min(naturalDuration, Math.max(.20, sourceSlot * 1.25));
      return {
        ...metric.glyph,
        shotId: shot.id,
        tokenId: `${metric.glyph.lineIndex}:${metric.glyph.wordIndex}`,
        role: box.role,
        fontSize: box.fontSize,
        weight: box.weight,
        motion,
        motionIndex: index % 6,
        vertical: box.vertical,
        flowX: box.vertical ? -sine : cosine,
        flowY: box.vertical ? cosine : sine,
        // Keep the original motion shape, scaled to the glyph's new layout.
        motionAmplitude: (box.role === 'hero' ? .72 : .52) * runtimeSettings.motionScale,
        x,
        y,
        rotation: box.rotation + ROTATION_DEGREES[index % ROTATION_DEGREES.length] * .18 * Math.PI / 180,
        width: metric.ink.right - metric.ink.left,
        height: metric.ink.bottom - metric.ink.top,
        ink: { ...metric.ink },
        entryDuration,
        enterAt: metric.glyph.enterAtMs / 1000,
        intervalEnd: metric.glyph.intervalEndMs / 1000,
        settleAt: metric.glyph.enterAtMs / 1000 + Math.max(entryDuration, reduceMotion ? .01 : .80),
      };
    });
  }

  function layoutShot(shot, shotIndex, previousMode) {
    const lines = shot.lines.map(index => compiled.lines[index]);
    const tokens = lines.flatMap(line => line.tokens.map(token => ({ token, line })));
    let mode = selectShotMode(shot, shotIndex, previousMode);
    const baseSize = shotBaseSize(shot, tokens.map(item => item.token));
    const boxes = tokens.flatMap(({ token, line }, tokenIndex) => {
      const measured = measureToken(token, line, mode, baseSize, tokenIndex);
      const maxTokenWidth = SAFE_W * .70;
      if (measured.vertical || measured.width <= maxTokenWidth || token.glyphs.length < 2) return [measured];
      const fragments = [];
      let glyphs = [];
      let width = 0;
      const flush = () => {
        if (!glyphs.length) return;
        fragments.push(measureToken({ ...token, glyphs,
          text: glyphs.map(glyph => glyph.char).join(''), fragmentIndex: fragments.length },
        line, mode, baseSize, tokenIndex, measured.fontSize));
        glyphs = [];
        width = 0;
      };
      measured.metrics.forEach(metric => {
        const advance = metric.advance + (glyphs.length ? measured.letterGap : 0);
        if (glyphs.length && width + advance > maxTokenWidth) flush();
        width += metric.advance + (glyphs.length ? measured.letterGap : 0);
        glyphs.push(metric.glyph);
      });
      flush();
      return fragments;
    });
    if (boxes.length > tokens.length) mode = 'grid';
    const spanSeconds = shot.spanMs / 1000;
    const targetWidth = clamp(spanSeconds * 305, 860, SAFE_W);
    if (mode === 'column') placeColumn(boxes, baseSize);
    else if (mode === 'grid') placeGrid(boxes, baseSize, targetWidth);
    else placeHorizontal(boxes, mode, baseSize);
    let bounds = centerComposition(boxes);
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const fit = Math.min(1, targetWidth / Math.max(1, width), SAFE_H / Math.max(1, height));
    if (fit < .999) {
      scaleComposition(boxes, fit);
      bounds = centerComposition(boxes);
    }
    const glyphs = boxes.flatMap(box => buildGlyphsForBox(box, shot));
    const lineViews = lines.map(line => {
      const lineGlyphs = glyphs.filter(glyph => glyph.lineIndex === line.lineIndex);
      const lineBoxes = boxes.filter(box => box.line.lineIndex === line.lineIndex);
      const lineBounds = boundsForBoxes(lineBoxes);
      return {
        line,
        glyphs: lineGlyphs,
        boxes: lineBoxes,
        firstAt: Math.min(...lineGlyphs.map(glyph => glyph.enterAt)),
        lastAt: Math.max(...lineGlyphs.map(glyph => glyph.enterAt)),
        endAt: (line.time + line.duration) / 1000,
        bounds: lineBounds,
      };
    });
    return {
      ...shot,
      mode,
      baseSize,
      boxes,
      glyphs,
      lineViews,
      localBounds: bounds,
      bounds: { ...bounds },
      centerX: 0,
      centerY: 0,
      takeId: null,
    };
  }

  function takeIndexForTime(timeMs) {
    let index = 0;
    compiled.hardClears.forEach(range => {
      if (timeMs >= range[1]) index += 1;
    });
    return index;
  }

  function compileWorld() {
    worldShots.length = 0;
    worldLines.length = 0;
    worldGlyphs.length = 0;
    worldTokens.length = 0;
    takes.length = 0;
    cameraKeys.length = 0;
    shotFadeWindows.clear();

    let previousMode = null;
    compiled.shots.forEach((shot, shotIndex) => {
      const view = layoutShot(shot, shotIndex, previousMode);
      previousMode = view.mode;
      worldShots.push(view);
    });

    const takeCount = compiled.hardClears.length + 1;
    for (let index = 0; index < takeCount; index += 1) {
      const hardBefore = compiled.hardClears[index - 1];
      const hardAfter = compiled.hardClears[index];
      takes.push({
        id: String(index + 1).padStart(2, '0'),
        start: index === 0 ? 0 : hardBefore[1] / 1000,
        end: hardAfter ? hardAfter[0] / 1000 : TOTAL,
        shots: [],
        lines: [],
        glyphs: [],
      });
    }

    worldShots.forEach(shot => {
      const takeIndex = takeIndexForTime(shot.startMs);
      const take = takes[takeIndex];
      shot.takeId = take.id;
      take.shots.push(shot);
    });

    takes.forEach(take => {
      let previous = null;
      take.shots.forEach((shot, shotIndex) => {
        if (!previous) {
          shot.centerX = 0;
          shot.centerY = 0;
        } else {
          // With a transparent stage there is no scenery to carry a long camera
          // move. Keep adjacent compositions close enough that the departing and
          // arriving type can share the frame while the camera crosses between
          // them. The offset is deterministic, so another song recompiles to a
          // different but repeatable world instead of inheriting fixed positions.
          const gap = 76 + (hash(`${compiled.song.title}|${shot.id}|gap`) % 48);
          const dx = (previous.bounds.right - previous.bounds.left) / 2
            + (shot.localBounds.right - shot.localBounds.left) / 2 + gap;
          const lowFrequency = Math.sin((shotIndex + takeIndexForTime(shot.startMs) * 1.7) * 1.18);
          const drift = lowFrequency * 205 + signed(`${shot.id}|y`) * 65;
          shot.centerX = previous.centerX + dx;
          shot.centerY = drift;
        }
        shot.boxes.forEach(box => {
          box.x += shot.centerX;
          box.y += shot.centerY;
          box.shotId = shot.id;
          box.takeId = take.id;
          worldTokens.push(box);
        });
        shot.glyphs.forEach(glyph => {
          glyph.x += shot.centerX;
          glyph.y += shot.centerY;
          glyph.takeId = take.id;
          worldGlyphs.push(glyph);
        });
        const orderedGlyphs = shot.glyphs.slice().sort((a, b) => a.enterAt - b.enterAt
          || a.lineIndex - b.lineIndex || a.wordIndex - b.wordIndex || a.charIndex - b.charIndex);
        orderedGlyphs.forEach((glyph, glyphIndex) => {
          let nearest = null;
          let nearestDistance = Infinity;
          for (let index = 0; index < glyphIndex; index += 1) {
            const candidate = orderedGlyphs[index];
            const distance = Math.hypot(glyph.x - candidate.x, glyph.y - candidate.y);
            if (distance > .001 && distance < nearestDistance) {
              nearest = candidate;
              nearestDistance = distance;
            }
          }
          if (!nearest) {
            glyph.approachX = glyph.flowX;
            glyph.approachY = glyph.flowY;
            return;
          }
          glyph.approachX = (glyph.x - nearest.x) / nearestDistance;
          glyph.approachY = (glyph.y - nearest.y) / nearestDistance;
        });
        shot.lineViews.forEach(view => {
          view.bounds = {
            left: view.bounds.left + shot.centerX,
            right: view.bounds.right + shot.centerX,
            top: view.bounds.top + shot.centerY,
            bottom: view.bounds.bottom + shot.centerY,
          };
          // These are the same glyph objects already translated by the shot.
          view.centerX = (view.bounds.left + view.bounds.right) / 2;
          view.centerY = (view.bounds.top + view.bounds.bottom) / 2;
          view.shot = shot;
          view.takeId = take.id;
          worldLines.push(view);
          take.lines.push(view);
        });
        shot.bounds = {
          left: shot.localBounds.left + shot.centerX,
          right: shot.localBounds.right + shot.centerX,
          top: shot.localBounds.top + shot.centerY,
          bottom: shot.localBounds.bottom + shot.centerY,
        };
        take.glyphs.push(...shot.glyphs);
        previous = shot;
      });
      take.glyphs.sort((a, b) => a.enterAt - b.enterAt
        || a.lineIndex - b.lineIndex || a.wordIndex - b.wordIndex || a.charIndex - b.charIndex);
      take.glyphs.forEach((glyph, glyphIndex) => {
        const nearbyEarlier = [];
        for (let index = 0; index < glyphIndex; index += 1) {
          const candidate = take.glyphs[index];
          const dx = glyph.x - candidate.x;
          const dy = glyph.y - candidate.y;
          const distance = Math.hypot(dx, dy);
          const influence = Math.max(260, (glyph.fontSize + candidate.fontSize) * 1.45);
          if (distance > .001 && distance <= influence) {
            nearbyEarlier.push({ x: dx / distance, y: dy / distance, distance });
          }
        }
        nearbyEarlier.sort((a, b) => a.distance - b.distance);
        glyph.avoidAxes = nearbyEarlier.slice(0, 8);
        const nearest = glyph.avoidAxes[0];
        if (nearest) {
          glyph.approachX = nearest.x;
          glyph.approachY = nearest.y;
        }
      });
      take.shots.forEach((shot, index) => {
        const next = take.shots[index + 1];
        if (!next) return;
        const lastSettledAt = Math.max(...shot.glyphs.map(glyph => glyph.settleAt));
        const nextAt = Math.min(...next.glyphs.map(glyph => glyph.enterAt));
        // Keep the outgoing typography present until its final character has
        // finished the original bounce.  This is a continuous camera hand-off,
        // not a scene-by-scene replacement.
        const start = Math.max(lastSettledAt + .04, nextAt + .28);
        shotFadeWindows.set(shot.id, {
          start,
          end: start + .64,
        });
      });
    });

    worldLines.sort((a, b) => a.line.lineIndex - b.line.lineIndex);
    worldLines.forEach(view => {
      const first = view.glyphs[0];
      const width = view.bounds.right - view.bounds.left;
      const height = view.bounds.bottom - view.bounds.top;
      const zoom = clamp(Math.min(1460 / Math.max(520, width), 780 / Math.max(280, height)), .69, .92);
      cameraKeys.push({
        time: view.firstAt,
        x: first ? lerp(view.centerX, first.x, .24) : view.centerX,
        y: first ? lerp(view.centerY, first.y, .24) : view.centerY,
        z: zoom,
        r: clamp(view.shot.boxes.reduce((sum, box) => sum + box.rotation, 0)
          / Math.max(1, view.shot.boxes.length) * .24, -.007, .007),
        lineIndex: view.line.lineIndex,
        takeId: view.takeId,
      });
    });
    takes.forEach(take => {
      const sourceKeys = cameraKeys.filter(key => key.takeId === take.id);
      if (!sourceKeys.length) return;
      // The line keys describe framing, not camera stops.  Duplicate hold keys
      // made the old path wait at a lyric and then depart on command, which read
      // as a sequence of scenes.  A continuous glyph guide below now owns x/y;
      // these sparse keys only provide a slowly changing zoom/rotation envelope.
      const keys = sourceKeys.slice();
      keys.unshift({ ...keys[0], time: take.start, lineIndex: null });
      keys.push({ ...keys.at(-1), time: Math.max(keys.at(-1).time + .25, take.end - .01), lineIndex: null });
      take.cameraKeys = keys;
    });
    compileCameraTables();
  }

  function activeTakeAt(time) {
    return takes.find((take, index) => (
      time >= take.start && (time < take.end || (index === takes.length - 1 && time <= take.end))
    )) || null;
  }

  function tangentAt(keys, index, field) {
    if (keys.length < 2) return 0;
    if (index <= 0) {
      const duration = Math.max(.001, keys[1].time - keys[0].time);
      return (keys[1][field] - keys[0][field]) / duration * .72;
    }
    if (index >= keys.length - 1) {
      const duration = Math.max(.001, keys.at(-1).time - keys.at(-2).time);
      return (keys.at(-1)[field] - keys.at(-2)[field]) / duration * .72;
    }
    const previous = keys[index - 1];
    const current = keys[index];
    const next = keys[index + 1];
    const beforeDuration = Math.max(.001, current.time - previous.time);
    const afterDuration = Math.max(.001, next.time - current.time);
    const beforeSlope = (current[field] - previous[field]) / beforeDuration;
    const afterSlope = (next[field] - current[field]) / afterDuration;
    if (beforeSlope * afterSlope <= 0) return 0;
    return (beforeSlope * afterDuration + afterSlope * beforeDuration)
      / (beforeDuration + afterDuration) * .76;
  }

  function interpolateField(keys, index, time, field) {
    const from = keys[index];
    const to = keys[Math.min(index + 1, keys.length - 1)];
    const duration = Math.max(.001, to.time - from.time);
    const progress = clamp((time - from.time) / duration);
    const p2 = progress * progress;
    const p3 = p2 * progress;
    const fromTangent = tangentAt(keys, index, field);
    const toTangent = tangentAt(keys, index + 1, field);
    return (2 * p3 - 3 * p2 + 1) * from[field]
      + (p3 - 2 * p2 + progress) * fromTangent * duration
      + (-2 * p3 + 3 * p2) * to[field]
      + (p3 - p2) * toTangent * duration;
  }

  function baseCameraFor(time, take) {
    const keys = take.cameraKeys;
    let index = keys.length - 2;
    for (let cursor = 0; cursor < keys.length - 1; cursor += 1) {
      if (time <= keys[cursor + 1].time) {
        index = cursor;
        break;
      }
    }
    return {
      x: interpolateField(keys, index, time, 'x'),
      y: interpolateField(keys, index, time, 'y'),
      z: clamp(interpolateField(keys, index, time, 'z'), .67, .94),
      r: clamp(interpolateField(keys, index, time, 'r'), -.009, .009),
    };
  }

  function glyphFocusAt(time, take) {
    const glyphs = take.glyphs;
    if (!glyphs.length) return { x: 0, y: 0, sameShot: true };
    if (time <= glyphs[0].enterAt) return { x: glyphs[0].x, y: glyphs[0].y, sameShot: true };
    if (time >= glyphs.at(-1).enterAt) return { x: glyphs.at(-1).x, y: glyphs.at(-1).y, sameShot: true };
    let low = 0;
    let high = glyphs.length - 1;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (glyphs[middle].enterAt <= time) low = middle;
      else high = middle;
    }
    const from = glyphs[low];
    const to = glyphs[high];
    const progress = clamp((time - from.enterAt) / Math.max(.001, to.enterAt - from.enterAt));
    return {
      x: lerp(from.x, to.x, progress),
      y: lerp(from.y, to.y, progress),
      sameShot: from.shotId === to.shotId,
    };
  }

  function smoothedGlyphFocus(time, take) {
    const samples = [
      [-1.20, 1], [-.90, 2], [-.60, 4], [-.30, 7],
      [0, 9],
      [.30, 7], [.60, 4], [.90, 2], [1.20, 1],
    ];
    const center = glyphFocusAt(time, take);
    let x = 0;
    let y = 0;
    let weight = 0;
    samples.forEach(([offset, value]) => {
      const point = glyphFocusAt(clamp(time + offset, take.start, take.end), take);
      x += point.x * value;
      y += point.y * value;
      weight += value;
    });
    return { x: x / weight, y: y / weight, sameShot: center.sameShot };
  }

  function rawCameraTargetFor(time, forcedTake = null, safetyTime = time) {
    const take = forcedTake || activeTakeAt(time);
    if (!take || !take.cameraKeys?.length) return { x: 0, y: 0, z: .78, r: 0, take: null };
    const base = baseCameraFor(time, take);
    const guide = smoothedGlyphFocus(time, take);
    const routeBlend = reduceMotion ? .66 : .84;
    const routeX = lerp(base.x, guide.x, routeBlend);
    const routeY = lerp(base.y, guide.y, routeBlend);
    const speedSample = .08;
    const guideBefore = smoothedGlyphFocus(clamp(time - speedSample, take.start, take.end), take);
    const guideAfter = smoothedGlyphFocus(clamp(time + speedSample, take.start, take.end), take);
    const guideSpeed = Math.hypot(guideAfter.x - guideBefore.x, guideAfter.y - guideBefore.y)
      / (speedSample * 2);
    const travelZoom = reduceMotion ? .84 : lerp(.90, .82, clamp(guideSpeed / 560));
    return keepReadHeadInFrame({
      x: routeX,
      y: routeY,
      // A quieter camera needs wider framing, not faster catch-up panning.
      z: clamp(base.z, .67, .94) * travelZoom,
      r: base.r,
      take,
    }, safetyTime, take);
  }

  function breathingAt(time, take) {
    if (reduceMotion || !take) return { x: 0, y: 0, z: 0, r: 0, gain: 0 };
    // Two incommensurate phases avoid a mechanical oval.  Breathing remains
    // analytic and is added after the body-camera simulation, so seeking never
    // changes it and it cannot inject steering impulses into the camera path.
    // Keep its amplitude constant within a take: modulating it with a
    // piecewise glyph-speed estimate reintroduced tiny derivative corners.
    const gain = .78 * runtimeSettings.breathScale;
    const phase = hash(compiled.song.title) * .0001;
    return {
      x: Math.sin(time * .43 + phase) * 11 * gain,
      y: Math.sin(time * .31 + phase * .71 + 1.17) * 7 * gain,
      z: Math.sin(time * .27 + phase * .3) * .0075 * gain,
      r: Math.sin(time * .19 + phase * .5) * .0011 * gain,
      gain,
    };
  }

  function readingGlyphsAt(time, take) {
    // The camera may anticipate the next composition, but it must not outrun a
    // newly sung character. This corridor is derived from measured glyph boxes,
    // not line numbers or song-specific camera corrections. Include a short
    // reading tail because the camera follower itself looks ahead in time.
    const reading = take.glyphs.filter(glyph => (
      glyph.enterAt <= time + .10 && glyph.intervalEnd >= time - .72
    ));
    // During an ordinary lyric gap retain the last readable glyph until its
    // successor has finished entering. Account for the follower's lookahead;
    // otherwise the old word can leave before the new one is legible.
    const readingLag = (reduceMotion ? .10 : .40) + .80;
    const anchor = take.glyphs.findLast(glyph => glyph.enterAt <= time - readingLag);
    if (anchor && !reading.includes(anchor)) reading.push(anchor);
    const lastEntered = take.glyphs.findLast(glyph => glyph.enterAt <= time);
    const upcoming = take.glyphs.find(glyph => glyph.enterAt > time);
    let carryLineIndex = null;
    if (lastEntered && upcoming && lastEntered.lineIndex !== upcoming.lineIndex) {
      carryLineIndex = lastEntered.lineIndex;
    } else if (lastEntered) {
      const activeLine = worldLines[lastEntered.lineIndex];
      const previousLine = worldLines[lastEntered.lineIndex - 1];
      if (activeLine && previousLine && previousLine.takeId === take.id
        && time <= activeLine.firstAt + .48) carryLineIndex = previousLine.line.lineIndex;
    }
    if (carryLineIndex != null) {
      take.glyphs.forEach(glyph => {
        if (glyph.lineIndex === carryLineIndex && glyph.enterAt <= time && !reading.includes(glyph)) {
          reading.push(glyph);
        }
      });
    }
    return reading;
  }

  function safeZoomForPosition(x, y, time, take, requestedZoom) {
    const reading = readingGlyphsAt(time, take);
    if (!reading.length) return requestedZoom;
    const bounds = reading.map(glyph => worldGlyphBounds(
      glyph,
      Math.max(time, glyph.enterAt + .00001),
      'full'
    ));
    const marginX = DESIGN_W * .065;
    const marginY = DESIGN_H * .065;
    const halfSafeWidth = DESIGN_W / 2 - marginX;
    const halfSafeHeight = DESIGN_H / 2 - marginY;
    let limit = requestedZoom;
    bounds.forEach(rect => {
      if (rect.left < x) limit = Math.min(limit, halfSafeWidth / Math.max(1, x - rect.left));
      if (rect.right > x) limit = Math.min(limit, halfSafeWidth / Math.max(1, rect.right - x));
      if (rect.top < y) limit = Math.min(limit, halfSafeHeight / Math.max(1, y - rect.top));
      if (rect.bottom > y) limit = Math.min(limit, halfSafeHeight / Math.max(1, rect.bottom - y));
    });
    // Reserve a little room for the analytic breathing offset and tiny camera
    // rotation; this prevents the safety net itself from flickering on/off.
    return clamp(Math.min(requestedZoom, limit * .965) - .008, reduceMotion ? .42 : .38, .94);
  }

  function keepReadHeadInFrame(target, time, take) {
    const reading = readingGlyphsAt(time, take);
    if (!reading.length) return target;
    const bounds = reading.map(glyph => worldGlyphBounds(
      glyph,
      Math.max(time, glyph.enterAt + .00001),
      'full'
    ));
    const left = Math.min(...bounds.map(rect => rect.left));
    const right = Math.max(...bounds.map(rect => rect.right));
    const top = Math.min(...bounds.map(rect => rect.top));
    const bottom = Math.max(...bounds.map(rect => rect.bottom));
    const fit = Math.min(DESIGN_W * .76 / Math.max(1, right - left),
      DESIGN_H * .70 / Math.max(1, bottom - top));
    const z = clamp(Math.min(target.z, fit), .52, .94);
    const halfWidth = DESIGN_W * .38 / z;
    const halfHeight = DESIGN_H * .35 / z;
    const x = right - left <= halfWidth * 2
      ? clamp(target.x, right - halfWidth, left + halfWidth)
      : (left + right) / 2;
    const y = bottom - top <= halfHeight * 2
      ? clamp(target.y, bottom - halfHeight, top + halfHeight)
      : (top + bottom) / 2;
    return { ...target, x, y, z };
  }

  function compileCameraTables() {
    cameraTables.clear();
    const hz = 120;
    const dt = 1 / hz;
    const maxSpeed = reduceMotion ? 420 : 840 * runtimeSettings.cameraScale;
    const maxAcceleration = reduceMotion ? 980 : 1850 * runtimeSettings.cameraScale;
    const maxJerk = reduceMotion ? 4200 : 6200 * runtimeSettings.cameraScale;
    const lead = reduceMotion ? .16 : .78 * runtimeSettings.cameraScale;
    takes.forEach(take => {
      if (!take.cameraKeys?.length) return;
      const frameCount = Math.max(2, Math.ceil((take.end - take.start) * hz) + 1);
      const frames = new Array(frameCount);
      const initial = rawCameraTargetFor(take.start, take);
      let x = initial.x;
      let y = initial.y;
      let z = initial.z;
      let r = initial.r;
      let velocityX = 0;
      let velocityY = 0;
      let accelerationX = 0;
      let accelerationY = 0;
      for (let index = 0; index < frameCount; index += 1) {
        const time = Math.min(take.end, take.start + index * dt);
        const targetTime = Math.min(take.end - .001, time + lead);
        const target = rawCameraTargetFor(Math.max(take.start, targetTime), take, time);
        frames[index] = {
          x, y, z, r,
          velocityX, velocityY,
          accelerationX, accelerationY,
          jerkX: 0, jerkY: 0,
        };
        if (index < frameCount - 1) {
          const velocitySample = .045;
          const beforeTime = Math.max(take.start, targetTime - velocitySample);
          const afterTime = Math.min(take.end - .001, targetTime + velocitySample);
          const beforeTarget = rawCameraTargetFor(beforeTime, take, Math.max(take.start, time - velocitySample));
          const afterTarget = rawCameraTargetFor(afterTime, take, Math.min(take.end - .001, time + velocitySample));
          const targetDuration = Math.max(.001, afterTime - beforeTime);
          const feedForwardX = (afterTarget.x - beforeTarget.x) / targetDuration;
          const feedForwardY = (afterTarget.y - beforeTarget.y) / targetDuration;
          let desiredX = feedForwardX + (target.x - x) / (reduceMotion ? 1.15 : .68);
          let desiredY = feedForwardY + (target.y - y) / (reduceMotion ? 1.15 : .68);
          const desiredSpeed = Math.hypot(desiredX, desiredY);
          if (desiredSpeed > maxSpeed) {
            const scale = maxSpeed / desiredSpeed;
            desiredX *= scale;
            desiredY *= scale;
          }
          let desiredAccelerationX = (desiredX - velocityX) / (reduceMotion ? .48 : .26);
          let desiredAccelerationY = (desiredY - velocityY) / (reduceMotion ? .48 : .26);
          const desiredAcceleration = Math.hypot(desiredAccelerationX, desiredAccelerationY);
          if (desiredAcceleration > maxAcceleration) {
            const scale = maxAcceleration / desiredAcceleration;
            desiredAccelerationX *= scale;
            desiredAccelerationY *= scale;
          }
          let jerkX = (desiredAccelerationX - accelerationX) / dt;
          let jerkY = (desiredAccelerationY - accelerationY) / dt;
          const jerk = Math.hypot(jerkX, jerkY);
          if (jerk > maxJerk) {
            const scale = maxJerk / jerk;
            jerkX *= scale;
            jerkY *= scale;
          }
          frames[index].jerkX = jerkX;
          frames[index].jerkY = jerkY;
          // Store and integrate the same constant-jerk segment. cameraFor()
          // evaluates this polynomial directly; it never linearly interpolates
          // precomputed positions, so position, velocity and acceleration stay
          // continuous at every 120 Hz table boundary.
          x += velocityX * dt + accelerationX * dt * dt / 2 + jerkX * dt * dt * dt / 6;
          y += velocityY * dt + accelerationY * dt * dt / 2 + jerkY * dt * dt * dt / 6;
          velocityX += accelerationX * dt + jerkX * dt * dt / 2;
          velocityY += accelerationY * dt + jerkY * dt * dt / 2;
          accelerationX += jerkX * dt;
          accelerationY += jerkY * dt;
          const zoomBlend = 1 - Math.exp(-dt / .46);
          const rotateBlend = 1 - Math.exp(-dt / .62);
          const zoomSafetyTime = Math.min(take.end - .001, time + (reduceMotion ? .28 : .68));
          const safeTargetZoom = safeZoomForPosition(x, y, zoomSafetyTime, take, target.z);
          z += (safeTargetZoom - z) * zoomBlend;
          r += (target.r - r) * rotateBlend;
        }
      }
      cameraTables.set(take.id, { hz, frames });
    });
  }

  function cameraFor(time) {
    const take = activeTakeAt(time);
    if (!take) return { x: 0, y: 0, z: .78, r: 0, take: null };
    const table = cameraTables.get(take.id);
    if (!table?.frames.length) return rawCameraTargetFor(time, take);
    const exact = clamp((time - take.start) * table.hz, 0, table.frames.length - 1);
    const fromIndex = Math.floor(exact);
    const toIndex = Math.min(table.frames.length - 1, fromIndex + 1);
    const progress = exact - fromIndex;
    const elapsed = progress / table.hz;
    const from = table.frames[fromIndex];
    const to = table.frames[toIndex];
    const breathing = breathingAt(time, take);
    const x = from.x + from.velocityX * elapsed + from.accelerationX * elapsed * elapsed / 2
      + from.jerkX * elapsed * elapsed * elapsed / 6 + breathing.x;
    const y = from.y + from.velocityY * elapsed + from.accelerationY * elapsed * elapsed / 2
      + from.jerkY * elapsed * elapsed * elapsed / 6 + breathing.y;
    const requestedZoom = lerp(from.z, to.z, progress) + breathing.z;
    return {
      x,
      y,
      z: safeZoomForPosition(x, y, time, take, requestedZoom),
      r: lerp(from.r, to.r, progress) + breathing.r,
      take,
    };
  }

  function glyphState(glyph, time) {
    if (time < glyph.enterAt) {
      return {
        visible: false,
        alpha: 0,
        x: glyph.x,
        y: glyph.y,
        rotation: glyph.rotation,
        scaleX: 1,
        scaleY: 1,
        progress: 0,
        visual: { dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 0, fill: 0, outline: 0, register: 0, echo: 0, echoX: 0, echoY: 0, settled: 0 },
      };
    }
    const age = Math.max(0, time - glyph.enterAt);
    const progress = reduceMotion ? 1 : clamp(age / Math.max(.01, glyph.entryDuration));
    const visual = glyphFx.sample({
      motion: glyph.motion,
      index: glyph.motionIndex,
      progress,
      age,
      start: glyph.enterAt,
      fontSize: glyph.fontSize,
      amplitude: glyph.motionAmplitude,
      rotationBase: glyph.rotation,
      reducedMotion: reduceMotion,
    });
    // A new character must approach from the unread side of its local text
    // flow. Reflect only a backwards component; preserve each original
    // motion's perpendicular drop/scatter and its scale/rotation/echo rhythm.
    // This prevents the next character from travelling through the character
    // that was just sung, which was the main source of apparent reordering.
    const approachX = glyph.approachX ?? glyph.flowX;
    const approachY = glyph.approachY ?? glyph.flowY;
    const along = visual.dx * approachX + visual.dy * approachY;
    if (along < 0) {
      visual.dx -= 2 * along * approachX;
      visual.dy -= 2 * along * approachY;
      const sign = glyph.motionIndex % 2 ? -1 : 1;
      if (!reduceMotion) {
        visual.echoX = -visual.dx * .24 + sign * 8;
        visual.echoY = -visual.dy * .18 + 8;
      }
    }
    // A token may have several already-readable neighbours (grid/column
    // layouts and a continuous shot hand-off). Remove any remaining component
    // that points into those occupied regions. Scale/rotation/bounce remain.
    for (let pass = 0; pass < 8; pass += 1) {
      (glyph.avoidAxes || []).forEach(axis => {
        const toward = visual.dx * axis.x + visual.dy * axis.y;
        if (toward < 0) {
          visual.dx -= toward * axis.x;
          visual.dy -= toward * axis.y;
        }
      });
    }
    // A diagonal move can be radially outward while one screen axis still
    // slips behind the nearest readable glyph (for example: mostly downward
    // but three pixels back to the left). Keep each meaningful screen-axis
    // component from reversing into that neighbour. This is a generic local
    // corridor, not a lyric- or coordinate-specific exception.
    const nearestAxis = glyph.avoidAxes?.[0];
    if (nearestAxis) {
      if (Math.abs(nearestAxis.x) >= .30 && visual.dx * nearestAxis.x < 0) visual.dx = 0;
      if (Math.abs(nearestAxis.y) >= .30 && visual.dy * nearestAxis.y < 0) visual.dy = 0;
    }
    // Back-easing can briefly enlarge a glyph even after its travel vector has
    // been steered away from readable neighbours. Preserve that bounce, but
    // spend its temporary extra radius as a small outward offset so outlines
    // do not brush in dense, staggered layouts.
    const bounceExpansion = Math.max(0, visual.scaleX - 1, visual.scaleY - 1) * glyph.fontSize * .58;
    if (nearestAxis && bounceExpansion > .001) {
      visual.dx += nearestAxis.x * bounceExpansion;
      visual.dy += nearestAxis.y * bounceExpansion;
    }
    if (!reduceMotion) {
      const sign = glyph.motionIndex % 2 ? -1 : 1;
      visual.echoX = -visual.dx * .24 + sign * 8;
      visual.echoY = -visual.dy * .18 + 8;
    }
    visual.settled = reduceMotion ? 1 : quintic((age - glyph.entryDuration * .82)
      / Math.max(.001, glyph.entryDuration * .18 + .62));
    const alpha = visual.alpha * shotOpacity(glyph.shotId, time);
    return {
      visible: true,
      alpha,
      x: glyph.x + visual.dx,
      y: glyph.y + visual.dy,
      rotation: glyph.rotation + visual.rotation,
      scaleX: visual.scaleX,
      scaleY: visual.scaleY,
      progress,
      visual,
    };
  }

  function shotOpacity(shotId, time) {
    const window = shotFadeWindows.get(shotId);
    if (!window || time <= window.start) return 1;
    if (time >= window.end) return 0;
    return 1 - quintic((time - window.start) / Math.max(.001, window.end - window.start));
  }

  function applyCamera(time, view) {
    const camera = cameraFor(time);
    const baseScale = Math.min(view.width / DESIGN_W, view.height / DESIGN_H);
    const projection = cameraProjection(camera);
    ctx.translate(view.width / 2, view.height / 2);
    ctx.rotate(projection.rotation);
    ctx.scale(baseScale * projection.zoom, baseScale * projection.zoom);
    ctx.translate(-camera.x, -camera.y);
    return camera;
  }

  function cameraProjection(camera) {
    // Reduced motion changes animation, not the fitted viewing area. Rendering
    // and diagnostics must project through exactly the same lens.
    return { zoom: camera.z, rotation: camera.r * (reduceMotion ? .15 : 1) };
  }

  function drawGlyph(glyph, time, pal) {
    const value = glyphState(glyph, time);
    if (!value.visible || value.alpha <= .001) return;
    ctx.save();
    ctx.translate(value.x, value.y);
    ctx.rotate(value.rotation);
    ctx.scale(value.scaleX, value.scaleY);
    glyphFx.drawGlyph(ctx, {
      char: glyph.char,
      fontSize: glyph.fontSize,
      weight: runtimeSettings.fontWeight,
      font: FONT,
      role: glyph.role,
      alpha: value.alpha,
      memory: 0,
      visual: value.visual,
      palette: pal,
      textAlign: 'center',
      textBaseline: 'middle',
    });
    ctx.restore();
  }

  function draw(time) {
    const view = frame();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    const take = activeTakeAt(time);
    if (!take) return;
    ctx.save();
    applyCamera(time, view);
    const pal = paletteForSettings();
    take.glyphs.forEach(glyph => drawGlyph(glyph, time, pal));
    ctx.restore();
  }

  function localGlyphBounds(glyph, value, kind = 'full') {
    // The world renderer owns the pose transform. Ask the effect helper only
    // for glyph-local ink/outline/register/echo extent, then project those four
    // corners through the exact same pose and camera matrices as drawing.
    const visual = {
      ...value.visual,
      dx: 0,
      dy: 0,
      rotation: 0,
      rot: 0,
      scaleX: 1,
      scaleY: 1,
    };
    const full = glyphFx.paintBounds({
      char: glyph.char,
      fontSize: glyph.fontSize,
      role: glyph.role,
      inkRect: glyph.ink,
      visual,
    });
    if (kind === 'collision') {
      const outline = Math.max(2.2, glyph.fontSize * (glyph.role === 'hero' ? .026 : .020)) / 2 + 1;
      return {
        left: full.ink.left - outline,
        right: full.ink.right + outline,
        top: full.ink.top - outline,
        bottom: full.ink.bottom + outline,
      };
    }
    return kind === 'body' ? full.body : full;
  }

  function transformedGlyphCorners(glyph, value, kind = 'full') {
    const rect = localGlyphBounds(glyph, value, kind);
    const cosine = Math.cos(value.rotation);
    const sine = Math.sin(value.rotation);
    return [
      [rect.left, rect.top], [rect.right, rect.top],
      [rect.right, rect.bottom], [rect.left, rect.bottom],
    ].map(([localX, localY]) => {
      const scaledX = localX * value.scaleX;
      const scaledY = localY * value.scaleY;
      return {
        x: value.x + scaledX * cosine - scaledY * sine,
        y: value.y + scaledX * sine + scaledY * cosine,
      };
    });
  }

  function boundsForPoints(points) {
    const left = Math.min(...points.map(point => point.x));
    const right = Math.max(...points.map(point => point.x));
    const top = Math.min(...points.map(point => point.y));
    const bottom = Math.max(...points.map(point => point.y));
    return { left, right, top, bottom, x: left, y: top, width: right - left, height: bottom - top };
  }

  function worldGlyphBounds(glyph, time, kind = 'full') {
    const value = glyphState(glyph, time);
    return { ...boundsForPoints(transformedGlyphCorners(glyph, value, kind)), alpha: value.alpha, visible: value.visible };
  }

  function screenGlyph(glyph, time, view = { width: DESIGN_W, height: DESIGN_H }, kind = 'full') {
    const value = glyphState(glyph, time);
    const camera = cameraFor(time);
    const projection = cameraProjection(camera);
    const scale = Math.min(view.width / DESIGN_W, view.height / DESIGN_H) * projection.zoom;
    const cosine = Math.cos(projection.rotation);
    const sine = Math.sin(projection.rotation);
    const points = transformedGlyphCorners(glyph, value, kind).map(point => {
      const dx = point.x - camera.x;
      const dy = point.y - camera.y;
      return {
        x: view.width / 2 + (dx * cosine - dy * sine) * scale,
        y: view.height / 2 + (dx * sine + dy * cosine) * scale,
      };
    });
    const rect = boundsForPoints(points);
    return {
      ...rect,
      centerX: (rect.left + rect.right) / 2,
      centerY: (rect.top + rect.bottom) / 2,
      alpha: value.alpha,
      visible: value.visible,
    };
  }

  function orderAudit() {
    const issues = [...compiled.audit.issues];
    worldLines.forEach(view => {
      const source = core.graphemes(view.line.text).join('');
      const rendered = view.glyphs.map(glyph => glyph.char).join('');
      if (source !== rendered) issues.push({ type: 'source-mismatch', lineIndex: view.line.lineIndex, source, rendered });
      for (let index = 1; index < view.glyphs.length; index += 1) {
        const previous = view.glyphs[index - 1];
        const current = view.glyphs[index];
        if (current.enterAt < previous.enterAt - .00001) {
          issues.push({ type: 'glyph-time-order', lineIndex: view.line.lineIndex, glyphIndex: index });
        }
      }
    });
    return issues;
  }

  function rectForToken(box) {
    const cosine = Math.abs(Math.cos(box.rotation));
    const sine = Math.abs(Math.sin(box.rotation));
    const width = (box.width * cosine + box.height * sine) * 1.02;
    const height = (box.width * sine + box.height * cosine) * 1.02;
    return { left: box.x - width / 2, right: box.x + width / 2, top: box.y - height / 2, bottom: box.y + height / 2 };
  }

  function collisionAudit() {
    const collisions = [];
    takes.forEach(take => {
      const boxes = worldTokens.filter(box => box.takeId === take.id);
      for (let first = 0; first < boxes.length; first += 1) {
        const a = rectForToken(boxes[first]);
        for (let second = first + 1; second < boxes.length; second += 1) {
          const b = rectForToken(boxes[second]);
          const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapWidth > .5 && overlapHeight > .5) {
            collisions.push({
              takeId: take.id,
              first: `${boxes[first].line.lineIndex}:${boxes[first].token.wordIndex}`,
              second: `${boxes[second].line.lineIndex}:${boxes[second].token.wordIndex}`,
              area: overlapWidth * overlapHeight,
            });
          }
        }
      }
    });
    return collisions;
  }

  function glyphBodyCollisionAudit() {
    const collisions = [];
    const seenPairs = new Set();
    takes.forEach(take => {
      const sampleTimes = new Set();
      take.glyphs.forEach(glyph => {
        const checkpoints = reduceMotion ? [0, 1] : [0, .18, .35, .55, .75, 1];
        checkpoints.forEach(progress => {
          const time = glyph.enterAt + glyph.entryDuration * progress;
          if (time >= take.start && time < take.end) sampleTimes.add(time.toFixed(4));
        });
        const ringTail = Math.min(take.end - .0001, glyph.enterAt + Math.max(glyph.entryDuration, .28) + .18);
        if (ringTail >= take.start) sampleTimes.add(ringTail.toFixed(4));
      });
      [...sampleTimes].map(Number).sort((a, b) => a - b).forEach(time => {
        const active = take.glyphs.flatMap(glyph => {
          const value = glyphState(glyph, time);
          if (!value.visible || value.alpha < .50 || value.visual.outline < .35) return [];
          return [{ glyph, value, rect: worldGlyphBounds(glyph, time, 'collision') }];
        }).sort((a, b) => a.rect.left - b.rect.left);
        for (let first = 0; first < active.length; first += 1) {
          const a = active[first];
          for (let second = first + 1; second < active.length; second += 1) {
            const b = active[second];
            if (b.rect.left >= a.rect.right) break;
            const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
            const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
            // The collision rect is actual measured ink plus the outline, not
            // the deliberately soft shadow/register/echo. Ignore one-pixel
            // AABB/anti-alias contact and report substantive letter overlap.
            const minimumWidth = Math.max(1, Math.min(a.rect.width, b.rect.width) * .025);
            const minimumHeight = Math.max(1, Math.min(a.rect.height, b.rect.height) * .025);
            if (overlapWidth <= minimumWidth || overlapHeight <= minimumHeight) continue;
            const aId = `${a.glyph.lineIndex}:${a.glyph.wordIndex}:${a.glyph.charIndex}`;
            const bId = `${b.glyph.lineIndex}:${b.glyph.wordIndex}:${b.glyph.charIndex}`;
            const pair = `${aId}|${bId}`;
            if (seenPairs.has(pair)) continue;
            seenPairs.add(pair);
            collisions.push({
              type: 'glyph-body-overlap',
              takeId: take.id,
              at: time,
              first: aId,
              second: bId,
              firstGlyph: a.glyph.char,
              secondGlyph: b.glyph.char,
              firstMotion: a.glyph.motion,
              secondMotion: b.glyph.motion,
              firstRole: a.glyph.role,
              secondRole: b.glyph.role,
              firstEnterAt: a.glyph.enterAt,
              secondEnterAt: b.glyph.enterAt,
              firstProgress: a.value.progress,
              secondProgress: b.value.progress,
              firstMotionOffset: { x: a.value.visual.dx, y: a.value.visual.dy },
              secondMotionOffset: { x: b.value.visual.dx, y: b.value.visual.dy },
              firstBase: { x: a.glyph.x, y: a.glyph.y },
              secondBase: { x: b.glyph.x, y: b.glyph.y },
              area: overlapWidth * overlapHeight,
              overlapWidth,
              overlapHeight,
              firstRect: { width: a.rect.width, height: a.rect.height },
              secondRect: { width: b.rect.width, height: b.rect.height },
            });
          }
        }
      });
    });
    return collisions;
  }

  function preOnsetPaintAudit() {
    return worldGlyphs.flatMap(glyph => {
      const value = glyphState(glyph, glyph.enterAt - .00001);
      const layers = value.visual || {};
      const leaks = value.visible || value.alpha !== 0
        || ['alpha', 'fill', 'outline', 'register', 'echo'].some(key => Number(layers[key]) > 0);
      return leaks ? [{ glyph: glyph.id, enterAt: glyph.enterAt, state: value }] : [];
    });
  }

  function cameraSpeedAt(time) {
    const sample = .008;
    const before = cameraFor(clamp(time - sample, 0, TOTAL));
    const after = cameraFor(clamp(time + sample, 0, TOTAL));
    if (before.take?.id !== after.take?.id) return 0;
    return Math.hypot(after.x - before.x, after.y - before.y) / (sample * 2);
  }

  function cameraAccelerationAt(time) {
    const sample = .016;
    const before = cameraFor(clamp(time - sample, 0, TOTAL));
    const current = cameraFor(time);
    const after = cameraFor(clamp(time + sample, 0, TOTAL));
    if (before.take?.id !== current.take?.id || after.take?.id !== current.take?.id) return 0;
    return Math.hypot(after.x - 2 * current.x + before.x,
      after.y - 2 * current.y + before.y) / (sample * sample);
  }

  function onsetVisibilityAudit(margin = .07) {
    const issues = [];
    worldGlyphs.forEach(glyph => {
      const from = glyph.enterAt + .00001;
      const take = takes.find(value => value.id === glyph.takeId);
      // Also cover the end of a short syllable's entrance. Take intervals are
      // half-open: a deliberate clear ends that take's visibility obligation.
      const to = Math.min(take.end - .00001, Math.max(glyph.intervalEnd, glyph.settleAt));
      if (to < from) return;
      const samples = Math.max(1, Math.ceil((to - from) / .05));
      for (let index = 0; index <= samples; index += 1) {
        const sampleAt = from + (to - from) * index / samples;
        const rect = screenGlyph(glyph, sampleAt);
        if (!rectWithinFrame(rect, margin)) {
          issues.push({ glyph: glyph.id, at: sampleAt, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          break;
        }
      }
    });
    return issues;
  }

  function rectWithinFrame(rect, margin) {
    return rect.x >= DESIGN_W * margin && rect.x + rect.width <= DESIGN_W * (1 - margin)
      && rect.y >= DESIGN_H * margin && rect.y + rect.height <= DESIGN_H * (1 - margin);
  }

  function isHardClear(time) {
    return compiled.hardClears.some(([from, to]) => time >= from / 1000 && time < to / 1000);
  }

  function blankAudit(step = .1) {
    const issues = [];
    const from = FIRST_LYRIC_AT;
    const to = Math.min(TOTAL, Math.max(...worldGlyphs.map(glyph => glyph.intervalEnd)));
    for (let time = from; time <= to; time += Math.max(.05, step)) {
      if (isHardClear(time)) continue;
      const take = activeTakeAt(time);
      if (!take) {
        issues.push({ time, type: 'no-take' });
        continue;
      }
      // A take's first glyph has a deliberate 0.20–0.40s entrance; do not call
      // its initial fade-in a mid-song empty-camera defect.
      if (time < (take.glyphs[0]?.enterAt ?? take.start) + .20) continue;
      const readable = take.glyphs.some(glyph => {
        if (glyph.enterAt > time) return false;
        const rect = screenGlyph(glyph, time, { width: DESIGN_W, height: DESIGN_H }, 'body');
        return rect.alpha >= .6 && rect.height >= 24
          && rectWithinFrame(rect, .05);
      });
      if (!readable) issues.push({ time, type: 'perceptual-blank' });
    }
    return issues;
  }

  function clearWorld() {
    worldShots.length = 0;
    worldLines.length = 0;
    worldGlyphs.length = 0;
    worldTokens.length = 0;
    takes.length = 0;
    cameraKeys.length = 0;
    cameraTables.clear();
    shotFadeWindows.clear();
    compiled = null;
    TOTAL = 0;
    FIRST_LYRIC_AT = 0;
    if (ctx && canvas) {
      const view = frame();
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.clearRect(0, 0, view.width, view.height);
    }
    if (globalThis.__wordscapeDebug?.owner === rootEl) delete globalThis.__wordscapeDebug;
  }

  function lineDuration(lines, index, words) {
    const line = lines[index] || {};
    const start = finite(line.time, 0);
    const nextStart = index + 1 < lines.length ? finite(lines[index + 1]?.time, 0) : 0;
    const declared = finite(line.duration ?? line.durationMs, 0);
    let wordEnd = start;
    for (const word of words) {
      const wordStart = word.absolute
        ? finite(word.absoluteStartMs, start)
        : start + finite(word.start, 0);
      wordEnd = Math.max(wordEnd, wordStart + finite(word.duration, 0));
    }
    let duration = declared > 0 ? declared : wordEnd > start ? wordEnd - start : 0;
    if (duration <= 0) {
      const glyphCount = Math.max(1, core.graphemes(line.text || '').filter(char => !/^\s+$/u.test(char)).length);
      const estimate = Math.max(900, Math.min(5000, glyphCount * 260));
      duration = nextStart > start ? Math.min(nextStart - start, estimate) : estimate;
    }
    if (nextStart > start) duration = Math.min(duration, nextStart - start);
    return Math.max(1, duration);
  }

  function normalizeSourceWords(line) {
    const source = Array.isArray(line?.words) ? line.words : [];
    return source.flatMap((word) => {
      if (!word || typeof word !== 'object') return [];
      const text = String(word.text ?? word.value ?? word.raw ?? '');
      if (!text) return [];
      const hasAbsolute = Number.isFinite(Number(word.absoluteStartMs))
        || (!Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.startMs)));
      const absoluteStartMs = Number.isFinite(Number(word.absoluteStartMs))
        ? Number(word.absoluteStartMs)
        : hasAbsolute ? Number(word.startMs) : null;
      const start = hasAbsolute ? 0 : finite(word.start ?? word.time, 0);
      let duration = finite(word.duration ?? word.durationMs, 0);
      if (duration <= 0 && Number.isFinite(Number(word.endMs))) {
        duration = Math.max(0, Number(word.endMs) - (hasAbsolute ? absoluteStartMs : finite(word.startMs, start)));
      }
      return [{
        text,
        start,
        duration,
        absolute: hasAbsolute,
        ...(hasAbsolute ? { absoluteStartMs } : {}),
      }];
    });
  }

  function relativeStart(word, lineStart) {
    return word.absolute ? finite(word.absoluteStartMs, lineStart) - lineStart : finite(word.start, 0);
  }

  function reconcileWords(text, sourceWords, lineStart, duration) {
    if (!sourceWords.length) return [];
    const result = [];
    let textCursor = 0;
    let previousEnd = 0;
    for (const word of sourceWords) {
      const found = text.indexOf(word.text, textCursor);
      if (found < textCursor) return [];
      const start = Math.max(0, Math.min(duration, relativeStart(word, lineStart)));
      if (found > textCursor) {
        const gapText = text.slice(textCursor, found);
        result.push({
          text: gapText,
          start: previousEnd,
          duration: Math.max(1, start - previousEnd),
          absolute: false,
        });
      }
      const clippedDuration = Math.max(1, Math.min(finite(word.duration, 1), duration - start || 1));
      result.push({ text: word.text, start, duration: clippedDuration, absolute: false });
      previousEnd = Math.min(duration, start + clippedDuration);
      textCursor = found + word.text.length;
    }
    if (textCursor < text.length) {
      result.push({
        text: text.slice(textCursor),
        start: previousEnd,
        duration: Math.max(1, duration - previousEnd),
        absolute: false,
      });
    }
    return result.map(word => {
      const start = Math.max(0, Math.min(duration - 1, finite(word.start, 0)));
      return {
        text: word.text,
        start,
        duration: Math.max(1, Math.min(finite(word.duration, 1), duration - start)),
      };
    });
  }

  function normalizeHostLyrics(lines) {
    const source = Array.isArray(lines) ? lines.filter(line => line && String(line.text || '').length > 0) : [];
    return source.map((line, index) => {
      const text = String(line.text || '');
      const lineStart = finite(line.time, 0);
      const rawWords = normalizeSourceWords(line);
      const duration = lineDuration(source, index, rawWords);
      const words = reconcileWords(text, rawWords, lineStart, duration);
      return { time: lineStart, duration, text, words };
    });
  }

  function validateCandidate(candidate) {
    if (!candidate?.glyphs?.length) throw new Error('找不到可播放的文字');
    if (candidate.lines.length > 500) throw new Error('歌詞超過 500 行');
    if (candidate.glyphs.length > 2500 || candidate.song.totalMs > 15 * 60 * 1000) {
      throw new Error('歌詞超過 2,500 字或 15 分鐘');
    }
    for (const line of candidate.lines) {
      if (!line.glyphs.length) throw new Error('歌詞含空白行');
      if (line.glyphs.length > 160) throw new Error('單行超過 160 字');
      if (core.graphemes(line.text).join('') !== line.glyphs.map(glyph => glyph.char).join('')) {
        throw new Error('整句文字與逐字資料不一致');
      }
    }
    if (!candidate.audit.valid) throw new Error('逐字時間不是原文順序');
  }

  function exposeDebug() {
    if (!compiled || !rootEl) return;
    const signature = worldTokens.map(box => (
      `${box.line.lineIndex}:${box.token.wordIndex}:${box.role}:${box.x.toFixed(2)}:${box.y.toFixed(2)}:${box.fontSize.toFixed(2)}`
    )).join('|');
    const cameraSignatureParts = [];
    cameraTables.forEach((table, takeId) => {
      for (let index = 0; index < table.frames.length; index += 12) {
        const frameValue = table.frames[index];
        cameraSignatureParts.push(
          `${takeId}:${index}:${frameValue.x.toFixed(3)}:${frameValue.y.toFixed(3)}:${frameValue.velocityX.toFixed(3)}:${frameValue.velocityY.toFixed(3)}:${frameValue.accelerationX.toFixed(3)}:${frameValue.accelerationY.toFixed(3)}:${frameValue.jerkX.toFixed(3)}:${frameValue.jerkY.toFixed(3)}`
        );
      }
    });
    globalThis.__wordscapeDebug = {
      owner: rootEl,
      version: '10.3.2-production-host',
      effectVersion: glyphFx.VERSION,
      compilerVersion: compiled.version,
      lineCount: compiled.lines.length,
      glyphCount: worldGlyphs.length,
      hardClears: compiled.hardClears.map(range => range.map(value => value / 1000)),
      determinismSignature: hash(signature).toString(16).padStart(8, '0'),
      cameraSignature: hash(cameraSignatureParts.join('|')).toString(16).padStart(8, '0'),
      cameraModel: 'continuous-target + constant-jerk body + analytic breathing',
      orderAudit,
      collisionAudit,
      glyphBodyCollisionAudit,
      preOnsetPaintAudit,
      onsetVisibilityAudit,
      blankAudit,
      cameraAt(time) {
        const value = cameraFor(Math.max(0, Math.min(TOTAL, finite(time, 0))));
        return { x: value.x, y: value.y, z: value.z, r: value.r, takeId: value.take?.id || null };
      },
      layoutAt(time) {
        const sampleTime = Math.max(0, Math.min(TOTAL, finite(time, 0)));
        const take = activeTakeAt(sampleTime);
        if (!take) return [];
        return take.glyphs.map(glyph => ({
          lineIndex: glyph.lineIndex,
          wordIndex: glyph.wordIndex,
          glyph: glyph.char,
          enterAt: glyph.enterAt,
          ...screenGlyph(glyph, sampleTime),
        }));
      },
    };
  }

  function rebuildFromContext(context, { preserveTime = true } = {}) {
    lastTemplateContext = context || lastTemplateContext;
    const lines = lastTemplateContext?.getLyrics?.() || [];
    if (!rootEl || !canvas || !ctx || !Array.isArray(lines) || lines.length === 0) {
      clearWorld();
      return false;
    }
    try {
      const normalized = normalizeHostLyrics(lines);
      const candidate = core.compile({
        title: document.body.dataset.lbTitle || 'Elitesand Pro',
        artist: document.body.dataset.lbArtist || '',
        lines: normalized,
      }, COMPILE_OPTIONS);
      validateCandidate(candidate);
      compiled = candidate;
      TOTAL = candidate.song.totalMs / 1000;
      FIRST_LYRIC_AT = (candidate.lines[0]?.time || 0) / 1000;
      compileWorld();
      exposeDebug();
      const nextTime = preserveTime
        ? Math.max(0, Math.min(TOTAL, finite(lastTemplateContext?.getCurrentTimeMs?.(), state.time * 1000) / 1000))
        : 0;
      state.time = nextTime;
      resize();
      draw(state.time);
      return true;
    } catch (error) {
      console.warn('[Wordscape] 無法建立這首歌：', error);
      clearWorld();
      return false;
    }
  }

  function applySettings(nextSettings = {}) {
    const intensity = ['calm', 'normal', 'chaotic'].includes(nextSettings.animationIntensity)
      ? nextSettings.animationIntensity : 'normal';
    const fontSize = Math.max(24, Math.min(96, finite(nextSettings.fontSize, 56)));
    const fontWeight = Math.round(Math.max(400, Math.min(950, finite(nextSettings.fontWeight, 900))));
    const fontFamily = normalizeColor(nextSettings.fontFamily, cssValue('--display-font-family', DEFAULT_FONT));
    const color = normalizeColor(nextSettings.color, cssValue('--lyric-color', '#0c0e12'));
    const activeColor = normalizeColor(nextSettings.activeColor, cssValue('--lyric-color-active', '#ed3153'));
    const motionScale = intensity === 'calm' ? .72 : intensity === 'chaotic' ? 1.12 : 1;
    const cameraScale = intensity === 'calm' ? .76 : 1;
    const breathScale = intensity === 'calm' ? .55 : intensity === 'chaotic' ? 1.08 : 1;
    const nextReduceMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const nextSignature = [fontFamily, fontWeight, fontSize, intensity, nextReduceMotion].join('|');

    FONT = fontFamily;
    runtimeSettings.fontWeight = fontWeight;
    runtimeSettings.typeScale = Math.max(.78, Math.min(1.25, fontSize / 56));
    runtimeSettings.motionScale = motionScale;
    runtimeSettings.cameraScale = cameraScale;
    runtimeSettings.breathScale = breathScale;
    runtimeSettings.color = color;
    runtimeSettings.activeColor = activeColor;
    state.ink = perceivedLight(color) ? 'light' : 'dark';
    reduceMotion = nextReduceMotion;

    const changedLayout = settingsSignature !== nextSignature;
    settingsSignature = nextSignature;
    if (changedLayout && compiled && lastTemplateContext) rebuildFromContext(lastTemplateContext);
    else if (compiled) draw(state.time);
  }

  function mount(container, context) {
    destroy();
    lifecycleGeneration += 1;
    const generation = lifecycleGeneration;
    lastTemplateContext = context || null;
    rootEl = document.createElement('div');
    rootEl.id = 'wordscape-root';
    rootEl.setAttribute('aria-hidden', 'true');
    canvas = document.createElement('canvas');
    canvas.className = 'wordscape-stage';
    rootEl.append(canvas);
    container.append(rootEl);
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) {
      console.warn('[Wordscape] Canvas 2D 不可用');
      return;
    }
    resizeObserver = new ResizeObserver(() => {
      if (generation !== lifecycleGeneration || !rootEl) return;
      resize();
      if (compiled) draw(state.time);
    });
    resizeObserver.observe(rootEl);
    resize();
    document.fonts?.ready.then(() => {
      if (generation !== lifecycleGeneration || !rootEl || !lastTemplateContext) return;
      rebuildFromContext(lastTemplateContext);
    });
  }

  function destroy() {
    lifecycleGeneration += 1;
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    clearWorld();
    if (rootEl?.parentNode) rootEl.parentNode.removeChild(rootEl);
    rootEl = null;
    canvas = null;
    ctx = null;
    lastTemplateContext = null;
    settingsSignature = '';
  }

  const template = {
    id: 'wordscape',
    label: '字界巡航',
    mount,
    destroy,
    onLyricsLoaded(_parsedLyrics, context) {
      rebuildFromContext(context, { preserveTime: true });
    },
    onLineChange() {
      // Absolute time owns both glyph and camera state; there is no scene reset.
    },
    onFrame(timeMs, context) {
      lastTemplateContext = context || lastTemplateContext;
      if (!compiled || !ctx) return;
      state.time = Math.max(0, Math.min(TOTAL, finite(timeMs, 0) / 1000));
      draw(state.time);
    },
    onSeek(timeMs, context) {
      lastTemplateContext = context || lastTemplateContext;
      if (!compiled || !ctx) return;
      state.time = Math.max(0, Math.min(TOTAL, finite(timeMs, 0) / 1000));
      draw(state.time);
    },
    onSettings(nextSettings, context) {
      lastTemplateContext = context || lastTemplateContext;
      applySettings(nextSettings || {});
    },
  };

  if (typeof LyricTemplates !== 'undefined') {
    LyricTemplates.register(template);
  } else {
    console.warn('[Wordscape] LyricTemplates registry 不存在');
  }
})();
