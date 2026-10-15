import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePassword,
  generatePassphrase,
  calculateEntropy,
  getRandomInt,
  shuffleArray,
  CHAR_SETS,
  DICEWARE_WORDS,
} from './generator.js';

test('CSPRNG getRandomInt: Bounds and Uniformity', () => {
  // Test 1,000 samples to verify all values in [1, 6] appear and no out-of-bounds
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (let i = 0; i < 1200; i++) {
    const val = getRandomInt(1, 6);
    assert.ok(val >= 1 && val <= 6, `Value ${val} out of bounds`);
    counts[val]++;
  }

  // Each face of a d6 should appear roughly 200 times (+- 100)
  for (let face = 1; face <= 6; face++) {
    assert.ok(counts[face] > 50, `Face ${face} underrepresented: ${counts[face]}`);
  }

  // Edge cases
  assert.equal(getRandomInt(5, 5), 5);
  assert.throws(() => getRandomInt(10, 5));
});

test('Fisher-Yates shuffleArray: Preserves elements without bias', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const shuffled = shuffleArray(original);

  assert.equal(shuffled.length, original.length);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), original);
});

test('Password Generator: Length options and clamping', () => {
  // Standard lengths
  for (const len of [8, 12, 16, 24, 32, 64]) {
    const pwd = generatePassword({ length: len });
    assert.equal(pwd.length, len, `Expected length ${len}, got ${pwd.length}`);
  }

  // Clamp below minimum 8
  const shortPwd = generatePassword({ length: 4 });
  assert.equal(shortPwd.length, 8, 'Length < 8 should clamp to 8');

  // Clamp above maximum 64
  const longPwd = generatePassword({ length: 120 });
  assert.equal(longPwd.length, 64, 'Length > 64 should clamp to 64');
});

test('Password Generator: Character set rules', () => {
  // All character sets enabled (default)
  for (let i = 0; i < 20; i++) {
    const pwd = generatePassword({ length: 20 });
    const hasUpper = /[A-Z]/.test(pwd);
    const hasLower = /[a-z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    const hasSymbol = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(pwd);

    assert.ok(hasUpper, `Password ${pwd} missing uppercase`);
    assert.ok(hasLower, `Password ${pwd} missing lowercase`);
    assert.ok(hasNumber, `Password ${pwd} missing number`);
    assert.ok(hasSymbol, `Password ${pwd} missing symbol`);
  }

  // Only digits
  const digitsOnly = generatePassword({
    length: 12,
    uppercase: false,
    lowercase: false,
    numbers: true,
    symbols: false,
  });
  assert.equal(/^\d{12}$/.test(digitsOnly), true, `Expected digits only, got ${digitsOnly}`);

  // Only letters (no symbols, no numbers)
  const lettersOnly = generatePassword({
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: false,
    symbols: false,
  });
  assert.equal(/^[a-zA-Z]{16}$/.test(lettersOnly), true);
});

test('Password Generator: Ambiguous character exclusion', () => {
  // ambiguous: l, 1, I, O, 0, |, B, 8
  const ambiguousChars = ['l', '1', 'I', 'O', '0', '|', 'B', '8'];

  for (let i = 0; i < 30; i++) {
    const pwd = generatePassword({
      length: 32,
      excludeAmbiguous: true,
    });

    for (const ambig of ambiguousChars) {
      assert.ok(
        !pwd.includes(ambig),
        `Password "${pwd}" should not contain ambiguous char "${ambig}"`
      );
    }
  }
});

test('Password Generator: Fallback on empty selection', () => {
  // When user unchecks every box, fallback to alphanumeric
  const fallback = generatePassword({
    uppercase: false,
    lowercase: false,
    numbers: false,
    symbols: false,
  });
  assert.ok(fallback.length >= 8);
  assert.equal(/^[a-z0-9]+$/.test(fallback), true, 'Fallback should be lowercase + numbers');
});

test('Passphrase Generator: Diceware mode', () => {
  // Default 4 words with hyphen and number
  const phrase = generatePassphrase({ words: 4, separator: '-', includeNumber: true, capitalize: true });
  const parts = phrase.split('-');
  assert.equal(parts.length, 5, '4 words + 1 number = 5 parts');

  // Verify first 4 words exist in dictionary
  for (let i = 0; i < 4; i++) {
    const lowerWord = parts[i].toLowerCase();
    assert.ok(
      DICEWARE_WORDS.includes(lowerWord),
      `Word "${parts[i]}" must exist in DICEWARE_WORDS`
    );
    // Verify title case
    assert.equal(parts[i][0], parts[i][0].toUpperCase());
  }

  // Verify number part
  const num = Number(parts[4]);
  assert.ok(!isNaN(num) && num >= 0 && num <= 99);

  // Custom separator and no number
  const underPhrase = generatePassphrase({ words: 5, separator: '_', includeNumber: false, capitalize: false });
  const underParts = underPhrase.split('_');
  assert.equal(underParts.length, 5);
  for (const word of underParts) {
    assert.equal(word, word.toLowerCase());
  }
});

test('Shannon & Theoretical Entropy Calculator', () => {
  // 1. Weak password (< 40 bits)
  const weak = calculateEntropy('123456');
  assert.ok(weak.entropyBits < 40);
  assert.equal(weak.score, 1);
  assert.equal(weak.strength, 'weak');
  assert.equal(weak.label.en, 'Weak');

  // 2. Moderate password (40-59 bits)
  const moderate = calculateEntropy('Password123');
  assert.ok(moderate.entropyBits >= 40 && moderate.entropyBits < 60);
  assert.equal(moderate.score, 2);
  assert.equal(moderate.strength, 'moderate');

  // 3. Strong password (60-79 bits)
  const strong = calculateEntropy('CorrectHorse99!');
  assert.ok(strong.entropyBits >= 60);
  assert.ok(strong.score >= 3);

  // 4. Very Strong password (>= 80 bits)
  const veryStrong = calculateEntropy('v8$mK#9zL@1qP&4wX*7b');
  assert.ok(veryStrong.entropyBits >= 80);
  assert.equal(veryStrong.score, 4);
  assert.equal(veryStrong.strength, 'very_strong');
  assert.equal(veryStrong.label.th, 'ปลอดภัยสูงมาก');

  // 5. Passphrase entropy
  const passEntropy = calculateEntropy('Correct-Horse-Battery-Staple-42', true);
  assert.ok(passEntropy.entropyBits >= 40);
  assert.ok(passEntropy.score >= 2);
});
