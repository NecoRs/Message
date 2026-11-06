// Renders the security tools' voice lines (Metasploit Framework / Classic)
// and the radio-dispatch chatter to WAV
// files with meSpeak (an espeak port — the classic robot voice). Run via npm
// in tools/sounds, then build_sounds.py turns these WAVs into the final MP3s.
//
//   node render_speech.cjs <out-dir>
//
// meSpeak is a GPL build tool; the rendered audio is ordinary program output,
// not covered by the tool's licence.
const fs = require('fs');
const path = require('path');
const mespeak = require('mespeak');

mespeak.loadConfig(require('mespeak/src/mespeak_config.json'));
mespeak.loadVoice(require('mespeak/voices/en/en-us.json'));

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node render_speech.cjs <out-dir>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

// A female-leaning robotic computer voice.
const VOICE = { speed: 160, pitch: 62, variant: 'f2', amplitude: 100 };

// Cybersecurity announcer lines for Metasploit Framework (the cinematic console).
const VOICE_LINES = {
  'voice-online-1': 'system online',
  'voice-online-2': 'firewall active',
  'voice-online-3': 'encryption enabled',
  'voice-operation-1': 'initiating security scan',
  'voice-operation-2': 'penetration test started',
  'voice-operation-3': 'monitoring network traffic',
  'voice-processing-1': 'decrypting data',
  'voice-processing-2': 'analyzing packets',
  'voice-processing-3': 'verifying checksums',
  'voice-analysis-1': 'scanning for vulnerabilities',
  'voice-analysis-2': 'port scan in progress',
  'voice-analysis-3': 'running threat analysis',
  'voice-complete-1': 'access granted',
  'voice-complete-2': 'threat neutralized',
  'voice-complete-3': 'system secured',
  'voice-warning-1': 'warning, intrusion detected',
  'voice-warning-2': 'malware detected',
  'voice-warning-3': 'suspicious activity detected',
  'voice-denied-1': 'access denied',
  'voice-denied-2': 'authentication failed',
  'voice-denied-3': 'connection blocked by firewall',
};

// An old-school computer voice for Metasploit Classic (lo-fi'd later).
const CLASSIC = { speed: 135, pitch: 45, variant: 'f4', amplitude: 100 };
const CLASSIC_LINES = {
  'cvoice-ready': 'system ready',
  'cvoice-connect': 'connection established',
  'cvoice-granted': 'access granted',
  'cvoice-denied': 'access denied',
  'cvoice-warning': 'warning, intrusion detected',
  'cvoice-scan': 'scanning network',
  'cvoice-decrypt': 'decrypting transmission',
  'cvoice-halt': 'system halted',
};

// Fictional police-style dispatch chatter for the radio bursts.
const RADIO = { speed: 185, pitch: 48, variant: 'm3', amplitude: 100 };
const RADIO_LINES = {
  'chatter-1': 'control, unit two one, ten four',
  'chatter-2': 'all units be advised, code three in progress',
  'chatter-3': 'dispatch, show me ten eight, over',
  'chatter-4': 'copy that, ten nine your last',
  'chatter-5': 'unit five respond, ten thirty three',
};

function render(key, text, opts) {
  const buf = mespeak.speak(text, { rawdata: 'buffer', ...opts });
  fs.writeFileSync(path.join(outDir, `${key}.wav`), buf);
  console.log(key, buf.length, 'bytes');
}

for (const [key, text] of Object.entries(VOICE_LINES)) render(key, text, VOICE);
for (const [key, text] of Object.entries(CLASSIC_LINES)) render(key, text, CLASSIC);
for (const [key, text] of Object.entries(RADIO_LINES)) render(key, text, RADIO);
