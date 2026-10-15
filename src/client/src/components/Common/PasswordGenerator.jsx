import React, { useState, useEffect, useCallback } from 'react';
import ClientCrypto from '../../services/crypto.js';
import { CopyIcon, CheckIcon, RefreshIcon, KeyIcon } from './Icons.jsx';
import { useToast } from './Toast.jsx';
import { Button } from '../ui/Button.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Slider } from '../ui/Slider.jsx';

export function PasswordGenerator({ onSelect, isEmbedded = false }) {
  const { addToast } = useToast();
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

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    addToast('คัดลอกรหัสผ่านแล้ว! (Copied to clipboard)', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUsePassword = () => {
    if (onSelect && result) {
      onSelect(result);
    }
  };

  // Strength score badge variant
  const getBadgeVariant = (score) => {
    if (score <= 1) return 'destructive';
    if (score === 2) return 'warning';
    if (score === 3) return 'info';
    return 'success';
  };

  const getScoreColor = (score) => {
    if (score <= 1) return 'bg-destructive';
    if (score === 2) return 'bg-warning';
    if (score === 3) return 'bg-info';
    return 'bg-success';
  };

  const content = (
    <div className="space-y-4">
      {/* Header & Mode Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
        {!isEmbedded ? (
          <div className="flex items-center space-x-3">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <KeyIcon className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {mode === 'password' ? 'สุ่มรหัสผ่านปลอดภัย' : 'สุ่มรหัสผ่านวลี (Diceware Passphrase)'}
              </h2>
              <p className="text-xs text-muted-foreground">
                สร้างรหัสผ่านที่มีเอนโทรปีสูงโดยใช้ CSPRNG ไม่มีการส่งข้อมูลผ่านเครือข่าย
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <KeyIcon className="size-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              {mode === 'password' ? 'สุ่มรหัสผ่าน (Password)' : 'สุ่มรหัสผ่านวลี (Passphrase)'}
            </span>
          </div>
        )}

        {/* Mode Toggle Buttons */}
        <div className="inline-flex items-center rounded-lg border border-border bg-muted p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('password')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              mode === 'password'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Random Password
          </button>
          <button
            type="button"
            onClick={() => setMode('passphrase')}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              mode === 'passphrase'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Diceware Passphrase
          </button>
        </div>
      </div>

      {/* Generated Display Box */}
      <div className="relative">
        <div className="w-full bg-muted/50 border border-input rounded-xl p-3 sm:p-4 pr-24 font-mono text-sm sm:text-base break-all text-primary font-medium tracking-wide select-all shadow-inner">
          {result || '...'}
        </div>
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={generate}
            title="สุ่มใหม่ (Regenerate)"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <RefreshIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            title="คัดลอก (Copy)"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            {copied ? <CheckIcon className="size-4 text-success" /> : <CopyIcon className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Entropy / Strength Display */}
      {strength && (
        <div className="p-3 bg-muted/30 rounded-xl border border-border space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <span className="text-muted-foreground">ความแข็งแรง:</span>
              <Badge variant={getBadgeVariant(strength.score)} round={true}>
                {strength.label.en} ({strength.label.th})
              </Badge>
            </div>
            <span className="font-mono text-muted-foreground text-[11px]">
              {strength.entropyBits} bits entropy | Pool: {strength.poolSize}
            </span>
          </div>
          <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden flex">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`h-full flex-1 border-r border-background last:border-none transition-all duration-300 ${
                  strength.score >= step ? getScoreColor(strength.score) : 'bg-transparent'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Mode Controls */}
      {mode === 'password' ? (
        <div className="space-y-4 text-sm">
          {/* Password Length Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <label htmlFor="length-slider" className="font-medium text-foreground">
                ความยาวรหัสผ่าน (Password Length):
              </label>
              <Badge variant="outline" className="font-mono">
                {length} ตัวอักษร (chars)
              </Badge>
            </div>
            <Slider
              id="length-slider"
              min={8}
              max={64}
              step={1}
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
            />
          </div>

          {/* Character Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <label className="flex items-center space-x-2.5 text-xs text-foreground bg-muted/40 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted/70 transition-colors">
              <input
                type="checkbox"
                checked={uppercase}
                onChange={(e) => setUppercase(e.target.checked)}
                className="size-4 rounded border-input text-primary focus:ring-ring"
              />
              <span>ตัวพิมพ์ใหญ่ (A-Z)</span>
            </label>

            <label className="flex items-center space-x-2.5 text-xs text-foreground bg-muted/40 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted/70 transition-colors">
              <input
                type="checkbox"
                checked={lowercase}
                onChange={(e) => setLowercase(e.target.checked)}
                className="size-4 rounded border-input text-primary focus:ring-ring"
              />
              <span>ตัวพิมพ์เล็ก (a-z)</span>
            </label>

            <label className="flex items-center space-x-2.5 text-xs text-foreground bg-muted/40 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted/70 transition-colors">
              <input
                type="checkbox"
                checked={numbers}
                onChange={(e) => setNumbers(e.target.checked)}
                className="size-4 rounded border-input text-primary focus:ring-ring"
              />
              <span>ตัวเลข (0-9)</span>
            </label>

            <label className="flex items-center space-x-2.5 text-xs text-foreground bg-muted/40 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted/70 transition-colors">
              <input
                type="checkbox"
                checked={symbols}
                onChange={(e) => setSymbols(e.target.checked)}
                className="size-4 rounded border-input text-primary focus:ring-ring"
              />
              <span>สัญลักษณ์พิเศษ (!@#$%...)</span>
            </label>

            <label className="flex items-center space-x-2.5 text-xs text-foreground bg-muted/40 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted/70 transition-colors col-span-1 sm:col-span-2">
              <input
                type="checkbox"
                checked={excludeAmbiguous}
                onChange={(e) => setExcludeAmbiguous(e.target.checked)}
                className="size-4 rounded border-input text-primary focus:ring-ring"
              />
              <span>ตัดตัวอักษรที่สับสนง่าย (Exclude ambiguous: l, 1, I, O, 0, B, 8)</span>
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {/* Diceware Words Count Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <label htmlFor="words-slider" className="font-medium text-foreground">
                จำนวนคำ (Word count):
              </label>
              <Badge variant="outline" className="font-mono">
                {words} คำ (~{words * 10} bits)
              </Badge>
            </div>
            <Slider
              id="words-slider"
              min={3}
              max={10}
              step={1}
              value={words}
              onChange={(e) => setWords(Number(e.target.value))}
            />
          </div>

          {/* Diceware Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <div className="bg-muted/40 p-2.5 rounded-lg border border-border flex items-center justify-between text-xs">
              <span className="text-foreground">ตัวคั่น (Separator):</span>
              <select
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                className="bg-background border border-input rounded-md px-2 py-1 text-foreground text-xs focus:ring-2 focus:ring-ring outline-none"
              >
                <option value="-">Hyphen (-)</option>
                <option value="_">Underscore (_)</option>
                <option value=".">Period (.)</option>
                <option value=" ">Space ( )</option>
              </select>
            </div>

            <label className="flex items-center space-x-2.5 text-xs text-foreground bg-muted/40 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted/70 transition-colors">
              <input
                type="checkbox"
                checked={capitalize}
                onChange={(e) => setCapitalize(e.target.checked)}
                className="size-4 rounded border-input text-primary focus:ring-ring"
              />
              <span>ขึ้นต้นด้วยตัวใหญ่ (Title Case)</span>
            </label>

            <label className="flex items-center space-x-2.5 text-xs text-foreground bg-muted/40 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted/70 transition-colors col-span-1 sm:col-span-2">
              <input
                type="checkbox"
                checked={includeNumber}
                onChange={(e) => setIncludeNumber(e.target.checked)}
                className="size-4 rounded border-input text-primary focus:ring-ring"
              />
              <span>ต่อท้ายด้วยตัวเลขสุ่ม (Append random number 0-99)</span>
            </label>
          </div>
        </div>
      )}

      {/* Embedded Selection Button */}
      {isEmbedded && onSelect && (
        <div className="pt-3 border-t border-border flex justify-end">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleUsePassword}
            className="flex items-center space-x-1.5"
          >
            <CheckIcon className="size-4" />
            <span>ใช้รหัสผ่านนี้ (Use This Password)</span>
          </Button>
        </div>
      )}
    </div>
  );

  if (isEmbedded) {
    return <div className="w-full">{content}</div>;
  }

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle>ตัวสร้างรหัสผ่าน (Password Generator)</CardTitle>
        <CardDescription>
          สร้างรหัสผ่านที่ปลอดภัยด้วยขั้นตอนวิธีสุ่มระดับวิทยาการรหัสลับ (Zero Modulo Bias CSPRNG)
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

export default PasswordGenerator;
