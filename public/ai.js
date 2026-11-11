/*
 * ProofPay AI engines — dependency-free, deterministic, explainable.
 *
 * Two engines live here:
 *   1. Brief Parser  — turns a plain-English client brief into milestones,
 *      each with a price and explicit acceptance criteria.
 *   2. Verification Engine — scores a freelancer's deliverable against those
 *      acceptance criteria, quoting evidence and naming gaps, and recommends
 *      RELEASE or REVISE. The AI verdict is the gate between a real PayPal
 *      capture (funding) and a real PayPal payout (release).
 *
 * No external models, no API keys, no randomness: the same input always
 * produces the same verdict, and every score can be explained term by term.
 *
 * Works in the browser (window.ProofPayAI) and in Node (module.exports).
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Text utilities                                                      */
  /* ------------------------------------------------------------------ */

  var STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
    'by', 'at', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
    'it', 'its', 'this', 'that', 'these', 'those', 'all', 'any', 'every',
    'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'our', 'their',
    'me', 'him', 'her', 'us', 'them', 'so', 'now', 'also', 'into', 'per',
    'et', 'al'
  ]);

  var FORMAT_WORDS = [
    'csv', 'pdf', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'png', 'jpg',
    'jpeg', 'gif', 'mp4', 'mp3', 'zip', 'json', 'html', 'figma', 'txt'
  ];

  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /* Very light stemmer: just enough to match "removed"~"remove",
   * "values"~"value", "dates"~"date", "filled"~"fill", etc. */
  function stem(w) {
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ied')) w = w.slice(0, -3) + 'y';
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
    return w;
  }

  function stemsMatch(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
    return false;
  }

  function splitSentences(text) {
    return String(text || '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function extractNumbers(text) {
    var out = [];
    var re = /(\d[\d,]*(?:\.\d+)?)/g;
    var m;
    var t = String(text || '');
    while ((m = re.exec(t)) !== null) out.push(parseFloat(m[1].replace(/,/g, '')));
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Criterion analysis                                                  */
  /* ------------------------------------------------------------------ */

  /* Extract the checkable parts of one acceptance criterion:
   *  - keyTerms:    meaningful words the deliverable should evidence
   *  - numberReqs:  measurable requirements, e.g. "at least 3 charts",
   *                 "800 words", "top 5 insights", "95% accuracy"
   *  - formats:     required file formats, e.g. csv, pdf
   */
  function analyseCriterion(text) {
    var raw = String(text || '');
    var tokens = tokenize(raw);

    var keyTerms = [];
    var seen = new Set();
    tokens.forEach(function (tok) {
      if (/^\d+$/.test(tok)) return;               // numbers handled separately
      if (STOPWORDS.has(tok)) return;
      if (tok.length < 3) return;
      var s = stem(tok);
      if (!seen.has(s)) { seen.add(s); keyTerms.push(s); }
    });

    var formats = [];
    var lower = ' ' + raw.toLowerCase() + ' ';
    FORMAT_WORDS.forEach(function (f) {
      var re = new RegExp('[\\s.,;:]' + f + '[\\s.,;:]|\\.' + f + '\\b');
      if (re.test(lower) && formats.indexOf(f) === -1) formats.push(f);
    });

    var numberReqs = [];
    var pctRe = /(\d[\d,]*(?:\.\d+)?)\s*%/g;
    var pm;
    while ((pm = pctRe.exec(raw)) !== null) {
      numberReqs.push({ value: parseFloat(pm[1].replace(/,/g, '')), unit: '%' });
    }
    var numRe = /(\d[\d,]*(?:\.\d+)?)\s+([a-z]+)/gi;
    var nm;
    while ((nm = numRe.exec(raw)) !== null) {
      var unit = nm[2].toLowerCase();
      if (STOPWORDS.has(unit)) continue;
      numberReqs.push({ value: parseFloat(nm[1].replace(/,/g, '')), unit: stem(unit) });
    }

    var critical = numberReqs.length > 0 || formats.length > 0 || /\bmust\b/i.test(raw);

    return {
      text: raw,
      keyTerms: keyTerms,
      numberReqs: numberReqs,
      formats: formats,
      critical: critical
    };
  }

  function termPresent(termStem, submissionStemSet) {
    var found = false;
    submissionStemSet.forEach(function (s) {
      if (!found && stemsMatch(termStem, s)) found = true;
    });
    return found;
  }

  /* ------------------------------------------------------------------ */
  /* Engine 1: Brief Parser                                              */
  /* ------------------------------------------------------------------ */

  var HEADER_RE = /^\s*(?:milestone|phase|step|deliverable)\s*(\d+)\s*[:\-–.)]\s*(.+)$/i;
  var BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/;

  function extractAmount(text) {
    var m = String(text || '').match(/\$\s?([\d,]+(?:\.\d{1,2})?)/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    m = String(text || '').match(/([\d,]+(?:\.\d{1,2})?)\s*(?:USD|dollars?)\b/i);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    return null;
  }

  function cleanTitle(title) {
    return title
      .replace(/\$\s?[\d,]+(?:\.\d{1,2})?/g, '')
      .replace(/[\d,]+(?:\.\d{1,2})?\s*(?:USD|dollars?)\b/gi, '')
      .replace(/\(\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/[\s\-–:]+$/g, '')
      .trim();
  }

  /* Sensible generated criteria, keyed by what the milestone talks about. */
  function fallbackCriteria(text) {
    var lower = String(text || '').toLowerCase();
    var out = [];
    function add(c) { if (out.indexOf(c) === -1) out.push(c); }
    if (/\b(dataset|data|csv|spreadsheet|excel)\b/.test(lower)) add('Deliver the cleaned dataset as a CSV file');
    if (/\b(report|summary|write|writing)\b/.test(lower)) add('Deliver a written summary report of the findings');
    if (/\b(chart|analysis|analyse|analyze|insight)\b/.test(lower)) add('Include charts that visualise the key findings');
    if (/\b(design|logo|brand|mockup)\b/.test(lower)) add('Deliver the final design files in the agreed format');
    if (/\b(code|app|website|api|software)\b/.test(lower)) add('Deliver working code with a short note on how to run it');
    add('The deliverable directly addresses every requirement in the brief');
    add('The work is complete, checked and ready for client review');
    return out.slice(0, 4);
  }

  function sentencesAsCriteria(bodyText) {
    return splitSentences(bodyText)
      .map(function (s) { return s.replace(/\$\s?[\d,]+(?:\.\d{1,2})?/g, '').trim(); })
      .filter(function (s) { return s.length >= 25; })
      .slice(0, 5)
      .map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); });
  }

  function buildMilestone(index, title, amount, criteriaTexts) {
    var criteria = criteriaTexts.slice(0, 6).map(function (t, i) {
      var a = analyseCriterion(t);
      return { id: 'c' + (index + 1) + '-' + (i + 1), text: t, critical: a.critical };
    });
    return {
      id: 'm' + (index + 1),
      title: title || ('Milestone ' + (index + 1)),
      amount: (amount === null || amount === undefined) ? 100 : amount,
      criteria: criteria
    };
  }

  function parseBrief(briefText) {
    var text = String(briefText || '').trim();
    var lines = text.split(/\r?\n/);
    var sections = [];
    var current = null;

    lines.forEach(function (line) {
      var h = line.match(HEADER_RE);
      if (h) {
        if (current) sections.push(current);
        current = { title: h[2].trim(), amount: extractAmount(h[2]), bullets: [], body: [] };
      } else if (current) {
        var b = line.match(BULLET_RE);
        if (b) current.bullets.push(b[1].trim());
        else if (line.trim()) current.body.push(line.trim());
      }
    });
    if (current) sections.push(current);

    var milestones = [];

    if (sections.length > 0) {
      sections.forEach(function (sec, i) {
        var amount = sec.amount;
        if (amount === null) amount = extractAmount(sec.body.join(' '));
        var criteriaTexts = sec.bullets.slice();
        if (criteriaTexts.length < 2) {
          sentencesAsCriteria(sec.body.join(' ')).forEach(function (s) {
            if (criteriaTexts.indexOf(s) === -1) criteriaTexts.push(s);
          });
        }
        if (criteriaTexts.length < 2) {
          fallbackCriteria(sec.title + ' ' + sec.body.join(' ')).forEach(function (s) {
            if (criteriaTexts.indexOf(s) === -1) criteriaTexts.push(s);
          });
        }
        milestones.push(buildMilestone(i, cleanTitle(sec.title), amount, criteriaTexts));
      });
    } else {
      /* No milestone headers: split on blank-line paragraphs. */
      var paragraphs = text.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
      if (paragraphs.length === 0) paragraphs = [text];
      paragraphs.forEach(function (para, i) {
        var amount = extractAmount(para);
        var bulletLines = [];
        var bodyLines = [];
        para.split(/\r?\n/).forEach(function (line) {
          var b = line.match(BULLET_RE);
          if (b) bulletLines.push(b[1].trim());
          else if (line.trim()) bodyLines.push(line.trim());
        });
        var criteriaTexts = bulletLines.slice();
        if (criteriaTexts.length < 2) {
          sentencesAsCriteria(bodyLines.join(' ')).forEach(function (s) {
            if (criteriaTexts.indexOf(s) === -1) criteriaTexts.push(s);
          });
        }
        if (criteriaTexts.length < 2) {
          fallbackCriteria(para).forEach(function (s) {
            if (criteriaTexts.indexOf(s) === -1) criteriaTexts.push(s);
          });
        }
        var firstWords = bodyLines.join(' ').split(/\s+/).slice(0, 6).join(' ');
        milestones.push(buildMilestone(i, cleanTitle(firstWords) || ('Milestone ' + (i + 1)), amount, criteriaTexts));
      });
    }

    var total = milestones.reduce(function (sum, m) { return sum + (Number(m.amount) || 0); }, 0);
    return { milestones: milestones, total: total };
  }

  /* ------------------------------------------------------------------ */
  /* Engine 2: Verification                                              */
  /* ------------------------------------------------------------------ */

  function verifyDeliverable(criteria, submission) {
    var text = '';
    var link = '';
    if (typeof submission === 'string') {
      text = submission;
    } else if (submission && typeof submission === 'object') {
      text = submission.text || '';
      link = submission.link || '';
    }
    var fullText = (text + ' ' + link).trim();
    var sentences = splitSentences(text);
    if (sentences.length === 0 && text.trim()) sentences = [text.trim()];

    var submissionStemSet = new Set(tokenize(fullText).map(stem));

    var results = (criteria || []).map(function (criterion, idx) {
      var critText = typeof criterion === 'string' ? criterion : (criterion.text || '');
      var a = analyseCriterion(critText);
      var critical = (typeof criterion === 'object' && typeof criterion.critical === 'boolean')
        ? criterion.critical : a.critical;

      /* Key-term coverage across the whole submission. */
      var matchedTerms = [];
      var unmatchedTerms = [];
      a.keyTerms.forEach(function (t) {
        if (termPresent(t, submissionStemSet)) matchedTerms.push(t);
        else unmatchedTerms.push(t);
      });
      var coverage = a.keyTerms.length ? matchedTerms.length / a.keyTerms.length : 0;

      /* Evidence: the sentence matching the most key terms. */
      var evidence = null;
      var bestHits = 0;
      sentences.forEach(function (s) {
        var sStems = new Set(tokenize(s).map(stem));
        var hits = 0;
        a.keyTerms.forEach(function (t) { if (termPresent(t, sStems)) hits++; });
        if (hits > bestHits) { bestHits = hits; evidence = s; }
      });
      if (bestHits === 0) evidence = null;

      /* Component scores: coverage, each measurable requirement, each format. */
      var components = [coverage * 100];
      var checks = [];

      a.numberReqs.forEach(function (req) {
        var satisfied = false;
        sentences.concat([fullText]).forEach(function (s) {
          if (satisfied) return;
          var nums = extractNumbers(s);
          var hasBigNumber = nums.some(function (n) { return n >= req.value; });
          if (!hasBigNumber) return;
          if (req.unit === '%') { if (/%/.test(s)) satisfied = true; return; }
          var sStems = new Set(tokenize(s).map(stem));
          if (termPresent(req.unit, sStems)) satisfied = true;
        });
        components.push(satisfied ? 100 : 0);
        checks.push({
          type: 'number',
          requirement: 'at least ' + req.value + ' ' + (req.unit === '%' ? '%' : req.unit),
          satisfied: satisfied
        });
      });

      a.formats.forEach(function (f) {
        var satisfied = termPresent(f, submissionStemSet) ||
          fullText.toLowerCase().indexOf('.' + f) !== -1;
        components.push(satisfied ? 100 : 0);
        checks.push({
          type: 'format',
          requirement: f.toUpperCase() + ' format',
          satisfied: satisfied
        });
      });

      var score = Math.round(components.reduce(function (x, y) { return x + y; }, 0) / components.length);
      var status = score >= 60 ? 'pass' : 'fail';

      var reasons = [];
      if (status === 'fail') {
        if (unmatchedTerms.length) {
          reasons.push('no evidence found for: ' + unmatchedTerms.slice(0, 6).join(', '));
        }
        checks.forEach(function (ch) {
          if (!ch.satisfied) reasons.push('missing measurable requirement: ' + ch.requirement);
        });
        if (!reasons.length) reasons.push('evidence is too thin to confirm this criterion');
      }

      return {
        index: idx,
        criterion: critText,
        critical: critical,
        score: score,
        status: status,
        coverage: Math.round(coverage * 100),
        evidence: evidence,
        checks: checks,
        reasons: reasons
      };
    });

    var overall = results.length
      ? Math.round(results.reduce(function (sum, r) { return sum + r.score; }, 0) / results.length)
      : 0;
    var criticalFailed = results.filter(function (r) { return r.critical && r.status === 'fail'; });
    var verdict = (overall >= 80 && criticalFailed.length === 0) ? 'release' : 'revise';

    var missingItems = results
      .filter(function (r) { return r.status === 'fail'; })
      .map(function (r) {
        return 'Criterion "' + r.criterion + '" — ' + r.reasons.join('; ');
      });

    return {
      score: overall,
      verdict: verdict,
      passed: results.filter(function (r) { return r.status === 'pass'; }).length,
      total: results.length,
      criticalFailed: criticalFailed.length,
      results: results,
      missingItems: missingItems,
      summary: verdict === 'release'
        ? 'The deliverable evidences the acceptance criteria (score ' + overall + '/100, no critical criterion failed). Release is recommended.'
        : 'The deliverable does not yet evidence every acceptance criterion (score ' + overall + '/100). ' +
          missingItems.length + ' item(s) need attention before release.'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Demo brief (used by the UI "Load demo brief" button and the tests)  */
  /* ------------------------------------------------------------------ */

  var DEMO_BRIEF = [
    'Milestone 1: Clean the raw sales dataset ($150)',
    '- Remove all duplicate rows and fix inconsistent date formats in the CSV file',
    '- Fill or flag missing values in the revenue column and document every change',
    '- Deliver the cleaned dataset as a CSV file',
    '',
    'Milestone 2: Analyse the cleaned data and write a summary report ($200)',
    '- Analyse sales by region and product category and include at least 3 charts',
    '- Write a summary report of at least 800 words in PDF format highlighting the top 5 insights',
    '- Include recommendations for the sales team based on the findings'
  ].join('\n');

  /* ------------------------------------------------------------------ */

  var api = {
    parseBrief: parseBrief,
    verifyDeliverable: verifyDeliverable,
    analyseCriterion: analyseCriterion,
    fallbackCriteria: fallbackCriteria,
    DEMO_BRIEF: DEMO_BRIEF,
    _internals: {
      tokenize: tokenize,
      stem: stem,
      splitSentences: splitSentences,
      extractNumbers: extractNumbers,
      extractAmount: extractAmount
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.ProofPayAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
