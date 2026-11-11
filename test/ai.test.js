/*
 * ProofPay AI engine tests — plain Node, no dependencies.
 * Run:  node test/ai.test.js
 */

'use strict';

var test = require('node:test');
var assert = require('node:assert');
var AI = require('../public/ai.js');

/* ------------------------------ parser ------------------------------ */

test('parser splits the demo brief into at least 2 milestones with criteria', function () {
  var parsed = AI.parseBrief(AI.DEMO_BRIEF);
  assert.ok(parsed.milestones.length >= 2, 'expected >= 2 milestones, got ' + parsed.milestones.length);

  var m1 = parsed.milestones[0];
  var m2 = parsed.milestones[1];

  assert.strictEqual(m1.amount, 150, 'milestone 1 amount should be $150');
  assert.strictEqual(m2.amount, 200, 'milestone 2 amount should be $200');
  assert.strictEqual(parsed.total, 350, 'total should be $350');

  assert.ok(/clean/i.test(m1.title), 'milestone 1 title should mention cleaning: ' + m1.title);
  assert.ok(/report|analyse/i.test(m2.title), 'milestone 2 title should mention the report/analysis: ' + m2.title);

  parsed.milestones.forEach(function (m, i) {
    assert.ok(m.criteria.length >= 2, 'milestone ' + (i + 1) + ' should have >= 2 criteria, got ' + m.criteria.length);
    m.criteria.forEach(function (c) {
      assert.ok(c.text && c.text.length > 10, 'criterion text should be meaningful');
      assert.strictEqual(typeof c.critical, 'boolean', 'criterion should carry a critical flag');
    });
  });
});

test('parser extracts measurable criteria (numbers and formats) as critical', function () {
  var parsed = AI.parseBrief(AI.DEMO_BRIEF);
  var m2criteria = parsed.milestones[1].criteria.map(function (c) { return c.text; }).join(' | ');
  assert.ok(/800 words/i.test(m2criteria), 'should keep the 800-word criterion');
  assert.ok(/3 charts/i.test(m2criteria), 'should keep the 3-charts criterion');
  var criticalCount = parsed.milestones[1].criteria.filter(function (c) { return c.critical; }).length;
  assert.ok(criticalCount >= 2, 'measurable/format criteria should be critical, got ' + criticalCount);
});

test('parser falls back gracefully on an unstructured brief', function () {
  var brief = 'I need someone to tidy up our customer spreadsheet and make it usable. ' +
    'The data has duplicates and messy dates and I need it back as a clean CSV file we can import.';
  var parsed = AI.parseBrief(brief);
  assert.ok(parsed.milestones.length >= 1, 'should produce at least one milestone');
  assert.ok(parsed.milestones[0].criteria.length >= 2, 'fallback criteria should be generated');
  assert.ok(parsed.milestones[0].amount > 0, 'a default amount should be assigned');
});

/* --------------------------- verification --------------------------- */

var COMPLETE_M1 = [
  'I cleaned the raw sales dataset and removed all duplicate rows.',
  'I fixed the inconsistent date formats in the CSV file so every date now uses one consistent format.',
  'I filled missing values in the revenue column and flagged the rows I could not fill, and I documented every change in a change log.',
  'The cleaned dataset is delivered as a CSV file (cleaned_sales.csv).'
].join(' ');

var INCOMPLETE_M1 = 'I worked on the dataset a bit and removed some duplicate rows. The file is attached, more to come later.';

var COMPLETE_M2 = [
  'I analysed sales by region and product category and included 4 charts covering regional revenue, category share, monthly trend and top products.',
  'I wrote a summary report of 950 words in PDF format highlighting the top 5 insights from the data.',
  'The report includes recommendations for the sales team based on the findings.'
].join(' ');

test('verification passes a complete milestone 1 deliverable and recommends release', function () {
  var parsed = AI.parseBrief(AI.DEMO_BRIEF);
  var report = AI.verifyDeliverable(parsed.milestones[0].criteria, {
    text: COMPLETE_M1,
    link: 'https://files.example.com/cleaned_sales.csv'
  });
  assert.strictEqual(report.verdict, 'release', 'expected release verdict, got ' + report.verdict + ' (score ' + report.score + ')');
  assert.ok(report.score >= 80, 'score should be >= 80, got ' + report.score);
  assert.strictEqual(report.criticalFailed, 0, 'no critical criterion should fail');
  report.results.forEach(function (r) {
    assert.strictEqual(r.status, 'pass', 'criterion should pass: ' + r.criterion + ' (score ' + r.score + ')');
    assert.ok(r.evidence, 'passing criterion should quote evidence: ' + r.criterion);
  });
});

test('verification passes a complete milestone 2 deliverable (measurable checks)', function () {
  var parsed = AI.parseBrief(AI.DEMO_BRIEF);
  var report = AI.verifyDeliverable(parsed.milestones[1].criteria, {
    text: COMPLETE_M2,
    link: 'https://files.example.com/sales-summary-report.pdf'
  });
  assert.strictEqual(report.verdict, 'release', 'expected release verdict, got ' + report.verdict + ' (score ' + report.score + ')');
  assert.ok(report.score >= 80, 'score should be >= 80, got ' + report.score);
});

test('verification fails an incomplete deliverable and names the gaps', function () {
  var parsed = AI.parseBrief(AI.DEMO_BRIEF);
  var report = AI.verifyDeliverable(parsed.milestones[0].criteria, { text: INCOMPLETE_M1, link: '' });
  assert.strictEqual(report.verdict, 'revise', 'expected revise verdict, got ' + report.verdict);
  assert.ok(report.score < 80, 'score should be < 80, got ' + report.score);
  assert.ok(report.missingItems.length >= 2, 'should name at least 2 gaps, got ' + report.missingItems.length);
  var gaps = report.missingItems.join('\n');
  assert.ok(/revenue/i.test(gaps), 'gaps should name the missing revenue-column criterion:\n' + gaps);
  var failed = report.results.filter(function (r) { return r.status === 'fail'; });
  assert.ok(failed.length >= 2, 'at least 2 criteria should fail');
});

test('verification is deterministic', function () {
  var parsed = AI.parseBrief(AI.DEMO_BRIEF);
  var a = AI.verifyDeliverable(parsed.milestones[0].criteria, { text: COMPLETE_M1, link: '' });
  var b = AI.verifyDeliverable(parsed.milestones[0].criteria, { text: COMPLETE_M1, link: '' });
  assert.deepStrictEqual(a, b, 'same input must produce the identical report');
});
