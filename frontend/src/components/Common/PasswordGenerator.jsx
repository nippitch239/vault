import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import ClientCrypto from '../../services/crypto.js';
import { CopyIcon, CheckIcon, RefreshIcon } from './Icons.jsx';
import { useToast } from './Toast.jsx';
import { Button } from '../ui/Button.jsx';
import { Card, CardContent } from '../ui/Card.jsx';
import { Slider } from '../ui/Slider.jsx';
import { Select, Label } from '../ui/Form.jsx';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

// Strength score (0–4) → token colours. Bars use the saturated "-foreground" tone so they
// stay visible on both themes; the text label always accompanies the colour.
const STRENGTH_BAR = ['bg-error-foreground', 'bg-error-foreground', 'bg-warning-foreground', 'bg-info-foreground', 'bg-success-foreground'];
const STRENGTH_TEXT = ['text-error-foreground', 'text-error-foreground', 'text-warning-foreground', 'text-info-foreground', 'text-success-foreground'];

const SEPARATORS = [
  ['-', 'ขีดกลาง ( - )'],
  ['_', 'ขีดล่าง ( _ )'],
  ['.', 'จุด ( . )'],
  [' ', 'เว้นวรรค'],
];

const checkboxClass =
  'size-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';

function CheckboxOption({ checked, onChange, children, className }) {
  return (
    <label className={cn('flex min-h-8 cursor-pointer items-center gap-2 text-sm text-foreground', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={checkboxClass} />
      <span>{children}</span>
    </label>
  );
}

function StrengthMeter({ strength, compact }) {
  if (!strength) return null;
  const score = Math.max(0, Math.min(4, Number(strength.score) || 0));
  const label = strength.label?.th || strength.label?.en || '';
  return (
    <div className={cn('flex items-center gap-3', compact ? '' : 'rounded-lg border border-border bg-card px-3 py-2.5')}>
      <div
        className={cn('flex flex-1 gap-1 overflow-hidden', compact ? 'h-1' : 'h-1.5')}
        role="meter"
        aria-label="ความแข็งแรงของรหัสผ่าน"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score}
        aria-valuetext={label}
      >
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={cn('h-full flex-1 rounded-full transition-colors duration-fast', score >= step ? STRENGTH_BAR[score] : 'bg-muted')}
          />
        ))}
      </div>
      <p className="shrink-0 text-caption text-muted-foreground" aria-live="polite">
        ความแข็งแรง: <span className={cn('font-ui', STRENGTH_TEXT[score])}>{label}</span>
        {!compact && strength.entropyBits != null && (
          <span className="hidden sm:inline"> · ประมาณ {Number(strength.entropyBits).toLocaleString('th-TH')} บิต</span>
        )}
      </p>
    </div>
  );
}

export function PasswordGenerator({ onSelect, isEmbedded = false, compact = false }) {
  const { addToast } = useToast();
  const idBase = useId();
  const [mode, setMode] = useState('password'); // 'password' or 'passphrase'

  // Password options
  const [length, setLength] = useState(18);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);

  // Passphrase options
  const [words, setWords] = useState(4);
  const [separator, setSeparator] = useState('-');
  const [capitalize, setCapitalize] = useState(true);
  const [includeNumber, setIncludeNumber] = useState(true);

  // Generated value & strength
  const [result, setResult] = useState('');
  const [strength, setStrength] = useState(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);

  const generate = useCallback(() => {
    let generated;
    if (mode === 'password') {
      generated = ClientCrypto.generateSecurePassword({
        length,
        uppercase,
        lowercase,
        numbers,
        symbols,
        excludeAmbiguous,
      });
    } else {
      generated = ClientCrypto.generateSecurePassphrase({
        words,
        separator,
        capitalize,
        includeNumber,
      });
    }
    setResult(generated);
    const entropy = ClientCrypto.calculateStrength(generated, mode === 'passphrase');
    setStrength(entropy);
    setCopied(false);
  }, [mode, length, uppercase, lowercase, numbers, symbols, excludeAmbiguous, words, separator, capitalize, includeNumber]);

  useEffect(() => {
    generate();
  }, [generate]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    addToast('คัดลอกรหัสผ่านแล้ว', 'success');
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleUsePassword = () => {
    if (onSelect && result) {
      onSelect(result);
    }
  };

  const lengthId = `${idBase}-length`;
  const wordsId = `${idBase}-words`;
  const isPassphrase = mode === 'passphrase';

  // ------------------------------------------------------------------ shared pieces

  const resultBox = (
    <div className="flex items-center gap-1 rounded-md border border-input bg-muted/40 py-1 pl-3 pr-1">
      <p
        className={cn(
          'min-w-0 flex-1 select-all break-all font-mono text-foreground',
          compact ? 'py-1 text-sm' : 'py-2 text-base'
        )}
      >
        {result || '…'}
      </p>
      <Button type="button" variant="ghost" size="icon-sm" onClick={generate} aria-label="สุ่มรหัสผ่านใหม่">
        <RefreshIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleCopy}
        disabled={!result}
        aria-label={copied ? 'คัดลอกแล้ว' : 'คัดลอกรหัสผ่าน'}
        className={copied ? 'text-success-foreground' : ''}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? 'คัดลอกรหัสผ่านแล้ว' : ''}
      </span>
    </div>
  );

  const lengthControl = (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={lengthId} className={compact ? 'text-caption' : ''}>
          ความยาว
        </Label>
        <span className="font-mono text-sm tabular-nums text-secondary-foreground" aria-hidden="true">
          {length} ตัวอักษร
        </span>
      </div>
      <Slider
        id={lengthId}
        min={8}
        max={64}
        step={1}
        value={length}
        aria-valuetext={`${length} ตัวอักษร`}
        onChange={(e) => setLength(Number(e.target.value))}
      />
    </div>
  );

  const wordsControl = (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={wordsId} className={compact ? 'text-caption' : ''}>
          จำนวนคำ
        </Label>
        <span className="font-mono text-sm tabular-nums text-secondary-foreground" aria-hidden="true">
          {words} คำ
        </span>
      </div>
      <Slider
        id={wordsId}
        min={3}
        max={10}
        step={1}
        value={words}
        aria-valuetext={`${words} คำ`}
        onChange={(e) => setWords(Number(e.target.value))}
      />
    </div>
  );

  // ------------------------------------------------------------------ compact (embedded in item form)

  if (compact) {
    return (
      <div className="grid w-full gap-3">
        {resultBox}
        <StrengthMeter strength={strength} compact />

        {isPassphrase ? (
          wordsControl
        ) : (
          <>
            {lengthControl}
            <fieldset>
              <legend className="sr-only">ชนิดตัวอักษรที่ใช้</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <CheckboxOption checked={uppercase} onChange={setUppercase}>A-Z</CheckboxOption>
                <CheckboxOption checked={lowercase} onChange={setLowercase}>a-z</CheckboxOption>
                <CheckboxOption checked={numbers} onChange={setNumbers}>0-9</CheckboxOption>
                <CheckboxOption checked={symbols} onChange={setSymbols}>สัญลักษณ์</CheckboxOption>
              </div>
            </fieldset>
          </>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-8 justify-start px-0"
            onClick={() => setMode(isPassphrase ? 'password' : 'passphrase')}
          >
            {isPassphrase ? 'ใช้รหัสผ่านแบบสุ่มตัวอักษรแทน' : 'ใช้วลีรหัสผ่านแทน'}
          </Button>
          {onSelect && (
            <Button type="button" size="sm" onClick={handleUsePassword} disabled={!result} className="w-full sm:w-auto">
              <CheckIcon />
              ใช้รหัสผ่านนี้
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ full layout

  const content = (
    <div className="grid gap-5">
      <div role="radiogroup" aria-label="รูปแบบ" className="inline-flex w-full rounded-md border border-border p-0.5 sm:w-auto sm:justify-self-start">
        {[
          ['password', 'รหัสผ่านแบบสุ่ม'],
          ['passphrase', 'วลีรหัสผ่าน'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              'min-h-8 flex-1 rounded px-3 py-1 text-sm font-ui transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none',
              mode === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        {resultBox}
        <StrengthMeter strength={strength} />
      </div>

      {isPassphrase ? (
        <div className="grid gap-4">
          {wordsControl}
          <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor={`${idBase}-separator`}>ตัวคั่นระหว่างคำ</Label>
              <Select id={`${idBase}-separator`} value={separator} onChange={(e) => setSeparator(e.target.value)}>
                {SEPARATORS.map(([value, label]) => (
                  <option key={label} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <fieldset className="grid gap-1">
              <legend className="sr-only">ตัวเลือกวลีรหัสผ่าน</legend>
              <CheckboxOption checked={capitalize} onChange={setCapitalize}>
                ขึ้นต้นแต่ละคำด้วยตัวพิมพ์ใหญ่
              </CheckboxOption>
              <CheckboxOption checked={includeNumber} onChange={setIncludeNumber}>
                ต่อท้ายด้วยตัวเลขสุ่ม (0–99)
              </CheckboxOption>
            </fieldset>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {lengthControl}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-ui text-foreground">ชนิดตัวอักษร</legend>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <CheckboxOption checked={uppercase} onChange={setUppercase}>
                ตัวพิมพ์ใหญ่ (A-Z)
              </CheckboxOption>
              <CheckboxOption checked={lowercase} onChange={setLowercase}>
                ตัวพิมพ์เล็ก (a-z)
              </CheckboxOption>
              <CheckboxOption checked={numbers} onChange={setNumbers}>
                ตัวเลข (0-9)
              </CheckboxOption>
              <CheckboxOption checked={symbols} onChange={setSymbols}>
                สัญลักษณ์ (!@#$%…)
              </CheckboxOption>
              <CheckboxOption checked={excludeAmbiguous} onChange={setExcludeAmbiguous} className="sm:col-span-2">
                ไม่ใช้ตัวอักษรที่สับสนง่าย (l, 1, I, O, 0, B, 8)
              </CheckboxOption>
            </div>
          </fieldset>
        </div>
      )}

      {isEmbedded && onSelect && (
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="button" size="sm" onClick={handleUsePassword} disabled={!result} className="w-full sm:w-auto">
            <CheckIcon />
            ใช้รหัสผ่านนี้
          </Button>
        </div>
      )}
    </div>
  );

  if (isEmbedded) {
    return <div className="w-full">{content}</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl tracking-tight">สร้างรหัสผ่าน</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          รหัสผ่านถูกสุ่มบนเครื่องของคุณเท่านั้น ไม่มีการส่งออกไปทางเครือข่าย
        </p>
      </header>
      <Card className="w-full">
        <CardContent className="p-5 sm:p-6">{content}</CardContent>
      </Card>
    </div>
  );
}

export default PasswordGenerator;
