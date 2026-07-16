/* Pure task grading helpers. Kept independent from Express/SQLite so the
   security-critical rules can be unit tested without starting the app. */

function normalizeText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function gradeTask(task, submission) {
  switch (task.type) {
    case 'quiz': {
      const selected = Number(submission);
      const expected = Number(task.answer);
      if (!Number.isInteger(selected)) return { gradable: true, correct: false };
      return { gradable: true, correct: selected === expected };
    }
    case 'fill':
      return {
        gradable: true,
        correct: normalizeText(submission) === normalizeText(task.answer),
      };
    case 'order': {
      const submitted = parseJsonArray(submission).map(String);
      const expected = parseJsonArray(task.items).map(String);
      return {
        gradable: true,
        correct: submitted.length === expected.length &&
          submitted.every((item, index) => item === expected[index]),
      };
    }
    case 'htmlcss':
    case 'blockly': {
      const submitted = normalizeText(submission).replace(/\s+/g, ' ');
      const expected = normalizeText(task.expected_output).replace(/\s+/g, ' ');
      return { gradable: !!expected, correct: !!submitted && submitted.includes(expected) };
    }
    default:
      return { gradable: false, correct: false };
  }
}

module.exports = { gradeTask, normalizeText, parseJsonArray };
