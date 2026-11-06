#!/usr/bin/env python3
"""Builds assets/sounds/*.mp3 from Kenney's CC0 sound packs.

Sources (both CC0 1.0, https://kenney.nl):
  * Interface Sounds  - https://kenney.nl/assets/interface-sounds
  * Sci-Fi Sounds     - https://kenney.nl/assets/sci-fi-sounds

Usage:
  python3 -I tools/sounds/build_sounds.py <interface-sounds-dir> <sci-fi-sounds-dir> [speech-wav-dir]

With a speech-wav-dir (produced by render_speech.cjs) it also builds the
spoken voice lines (voice-*.mp3) and the police radio-chatter bursts
(radio-*.mp3, dispatch speech wrapped in squelch + static).

Each output is trimmed, faded, peak-normalised and encoded as mono MP3.
Loops are made seamless with an equal-power crossfade of their tail into
their head. Requires ffmpeg (with libmp3lame) and numpy.
"""
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

RATE = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'sounds')

# A dark, menacing "black-hat" set. Everything is pitched down and driven
# into soft distortion for a deeper, dirtier, more ominous character.
# options: pitch (resample factor, <1 = deeper), drive (distortion),
#          crush (bit-depth), lowpass/highpass (Hz), tail (reverb seconds), peak
ONE_SHOTS = {
    'type-1': ('ui', 'glitch_001.wav', {'pitch': 0.82, 'drive': 2.4, 'peak': -5.0}),
    'type-2': ('ui', 'glitch_002.wav', {'pitch': 0.82, 'drive': 2.4, 'peak': -5.0}),
    'type-3': ('ui', 'glitch_004.wav', {'pitch': 0.8, 'drive': 2.4, 'peak': -5.0}),
    'type-4': ('ui', 'glitch_003.wav', {'pitch': 0.8, 'drive': 2.4, 'peak': -5.0}),
    'type-5': ('ui', 'tick_002.wav', {'pitch': 0.82, 'drive': 2.0, 'peak': -5.0}),
    'tick': ('ui', 'glitch_003.wav', {'pitch': 0.8, 'drive': 2.0, 'peak': -4.0}),
    'row-1': ('ui', 'glitch_004.wav', {'pitch': 0.78, 'drive': 2.2, 'peak': -4.0}),
    'row-2': ('ui', 'drop_002.wav', {'pitch': 0.78, 'drive': 2.0, 'peak': -5.0}),
    'blip': ('ui', 'glitch_002.wav', {'pitch': 0.76, 'drive': 2.6, 'peak': -3.0}),
    'success-1': ('ui', 'confirmation_002.wav', {'pitch': 0.78, 'drive': 1.6, 'lowpass': 5200, 'peak': -2.0}),
    'success-2': ('ui', 'confirmation_003.wav', {'pitch': 0.76, 'drive': 1.6, 'lowpass': 5200, 'peak': -2.0}),
    'warning': ('fx', 'impact_metal_004.ogg', {'pitch': 0.74, 'drive': 3.0, 'lowpass': 2200, 'tail': 0.5, 'peak': -2.0}),
    'error': ('fx', 'impact_metal_002.ogg', {'pitch': 0.6, 'drive': 3.5, 'lowpass': 1700, 'tail': 0.7, 'peak': -1.0}),
    'sweep-1': ('fx', 'force_field_000.ogg', {'pitch': 0.72, 'drive': 1.8, 'lowpass': 3200, 'peak': -2.0}),
    'sweep-2': ('fx', 'force_field_002.ogg', {'pitch': 0.72, 'drive': 1.8, 'lowpass': 3200, 'peak': -2.0}),
    'sweep-3': ('fx', 'low_frequency_explosion_000.ogg', {'pitch': 0.8, 'drive': 1.5, 'lowpass': 2600, 'tail': 0.6, 'peak': -3.0}),
    'stinger': ('fx', 'impact_metal_001.ogg', {'pitch': 0.55, 'drive': 3.0, 'lowpass': 1400, 'tail': 1.1, 'peak': -1.0}),
    'boot': ('fx', 'low_frequency_explosion_001.ogg', {'pitch': 0.62, 'drive': 2.0, 'lowpass': 2200, 'tail': 0.8, 'peak': -1.0}),
}
# "digital execute": a deep, distorted retro laser zap with a glitch in front
LAYERED = {
    'execute': [('ui', 'glitch_002.wav', 0.0, 0.8, {'pitch': 0.8, 'drive': 3.0}),
                ('fx', 'laser_retro_000.ogg', 0.015, 0.9, {'pitch': 0.68, 'drive': 2.6, 'lowpass': 4000})],
}
LOOPS = {
    'loop-processing': ('fx', 'computer_noise_002.ogg', {'pitch': 0.9, 'drive': 1.6, 'lowpass': 5200, 'peak': -4.0}),
    'loop-ambience': ('fx', 'space_engine_low_001.ogg', {'pitch': 0.68, 'drive': 1.4, 'lowpass': 520, 'dread': True, 'peak': -3.0}),
}

# Spoken lines rendered by render_speech.cjs. Light robot shaping keeps them
# intelligible but gives the computer tone a little grit.
VOICE_SHAPE = {'pitch': 0.97, 'drive': 1.4, 'highpass': 170, 'lowpass': 5000, 'peak': -1.5}
VOICE_KEYS = [f'voice-{kind}-{i}' for kind in ('online', 'operation', 'processing', 'analysis', 'complete', 'warning', 'denied') for i in (1, 2, 3)]
# The classic tool's voice: an 80s speech-chip feel (decimated, bit-crushed, phone-band).
CLASSIC_VOICE_SHAPE = {'pitch': 0.96, 'decimate': 4, 'crush': 6, 'highpass': 260, 'lowpass': 3600, 'drive': 1.7, 'peak': -2.0}
CLASSIC_VOICE_KEYS = ['cvoice-ready', 'cvoice-connect', 'cvoice-granted', 'cvoice-denied',
                      'cvoice-warning', 'cvoice-scan', 'cvoice-decrypt', 'cvoice-halt']
# Dispatch lines wrapped in squelch + static become the radio bursts.
RADIO_KEYS = ['chatter-1', 'chatter-2', 'chatter-3', 'chatter-4', 'chatter-5']


def load(path):
    cmd = ['ffmpeg', '-nostdin', '-v', 'error', '-i', path,
           '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def _filter(x, lo=None, hi=None):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    if hi:
        spec[f > hi] = 0
    if lo:
        spec[f < lo] = 0
    return np.fft.irfft(spec, len(x))


def shape(x, opt):
    """Darkens a sound: pitch down (resample), soft-clip distortion, optional
    bit-crush, band limits, a short decaying tail and a dread sub-layer."""
    pitch = opt.get('pitch', 1.0)
    if pitch and pitch != 1.0:                       # resample => lower + longer
        idx = np.arange(0, len(x), pitch)
        x = np.interp(idx, np.arange(len(x)), x)
    if opt.get('highpass') or opt.get('lowpass'):
        x = _filter(x, opt.get('highpass'), opt.get('lowpass'))
    dec = opt.get('decimate')
    if dec:                                          # sample-and-hold => lo-fi
        x = np.repeat(x[::dec], dec)[:len(x)]
    drive = opt.get('drive')
    if drive:                                        # tanh soft clipping
        x = np.tanh(drive * x) / np.tanh(drive)
    crush = opt.get('crush')
    if crush:                                        # quantise to N bits
        levels = 2 ** crush
        x = np.round(x * levels) / levels
    tail = opt.get('tail')
    if tail:                                         # cheap decaying reverb tail
        n = int(tail * RATE)
        out = np.zeros(len(x) + n)
        out[:len(x)] = x
        for delay, gain in ((0.035, 0.5), (0.07, 0.32), (0.13, 0.2), (0.21, 0.12)):
            d = int(delay * RATE)
            decay = gain * np.exp(-np.arange(len(x)) / (tail * RATE * 0.6))
            out[d:d + len(x)] += x * decay
        x = out
    if opt.get('dread'):                             # add a dissonant low sub
        t = np.arange(len(x)) / RATE
        sub = 0.22 * np.sin(2 * np.pi * 36 * t) + 0.12 * np.sin(2 * np.pi * 54.5 * t)
        sub *= 0.5 + 0.5 * np.sin(2 * np.pi * 0.09 * t)   # slow throb
        x = x + sub
    return x


def trim(x, threshold_db=-50.0):
    thr = 10 ** (threshold_db / 20)
    idx = np.flatnonzero(np.abs(x) > thr)
    if not len(idx):
        return x
    start = max(0, idx[0] - int(0.002 * RATE))
    end = min(len(x), idx[-1] + int(0.01 * RATE))
    return x[start:end]


def fade(x, fade_in=0.002, fade_out=0.012):
    x = x.copy()
    a = min(len(x) // 2, int(fade_in * RATE))
    b = min(len(x) // 2, int(fade_out * RATE))
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def normalise(x, peak_db=-1.0):
    peak = np.max(np.abs(x)) or 1.0
    return x * (10 ** (peak_db / 20) / peak)


def seamless(x, seconds=0.6):
    """Crossfades the last `seconds` into the first so the clip loops cleanly."""
    n = int(seconds * RATE)
    head, body, tail = x[:n], x[n:-n], x[-n:]
    t = np.linspace(0, np.pi / 2, n)
    mixed = tail * np.cos(t) + head * np.sin(t)
    return np.concatenate([mixed, body])


def write_mp3(name, x, bitrate='128k'):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        path = tmp.name
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    out = os.path.join(OUT, f'{name}.mp3')
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', path, '-codec:a', 'libmp3lame', '-b:a', bitrate, '-ac', '1', out], check=True)
    os.unlink(path)
    return out


def bandpass(x, lo, hi):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    spec[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(spec, len(x))


def radio_burst(seed):
    """A synthesised police/comms radio squelch: open click, band-limited
    static with crackle, close click, and (sometimes) a roger beep. No voice,
    no sample — generated here, so it is free of any third-party audio."""
    rng = np.random.default_rng(seed)
    click = lambda ms, lo, hi: bandpass(rng.standard_normal(int(ms / 1000 * RATE)), lo, hi)
    open_click = click(10, 1500, 6500) * np.linspace(1, 0, int(0.01 * RATE)) ** 1.5
    body_len = int(rng.uniform(0.18, 0.46) * RATE)
    body = bandpass(rng.standard_normal(body_len), 340, 2900)
    t = np.arange(body_len) / RATE
    body *= 0.6 + 0.4 * np.sin(2 * np.pi * rng.uniform(18, 34) * t)  # tremolo
    for _ in range(rng.integers(3, 9)):  # crackle pops
        p = rng.integers(0, body_len)
        body[p:p + 40] += rng.uniform(0.5, 1.2) * np.hanning(min(40, body_len - p))
    env = np.ones(body_len)
    a, d = int(0.006 * RATE), int(0.03 * RATE)
    env[:a] = np.linspace(0, 1, a)
    env[-d:] = np.linspace(1, 0, d)
    body *= env * 0.5
    close_click = click(7, 1200, 5000) * np.linspace(1, 0, int(0.007 * RATE)) ** 1.5
    parts = [open_click, body, close_click]
    if rng.random() < 0.5:  # roger beep
        n = int(0.06 * RATE)
        beep = np.sin(2 * np.pi * rng.choice([1100, 1300, 1500]) * np.arange(n) / RATE)
        beep *= np.hanning(n) * 0.35
        parts += [np.zeros(int(0.02 * RATE)), beep]
    return normalise(np.concatenate(parts), -6.0)


# ------------------------------------------------------- classic retro sounds
# Generated here (no samples): the sounds of an old 80s/90s workstation.

def _t(dur):
    return np.arange(int(dur * RATE)) / RATE


def _tone(freq, dur, kind='sine'):
    t = _t(dur)
    ph = 2 * np.pi * freq * t
    if kind == 'square':
        return np.sign(np.sin(ph))
    return np.sin(ph)


def _edges(x, a=0.003, d=0.006):
    return fade(x, a, d)


def classic_key(seed):
    """A mechanical (buckling-spring style) key: click, thock, spring, release."""
    rng = np.random.default_rng(seed)
    n = int(0.13 * RATE)
    out = np.zeros(n)
    click = bandpass(rng.standard_normal(int(0.004 * RATE)), 2200, 9000)
    click *= np.linspace(1, 0, len(click)) ** 2
    out[:len(click)] += click * 0.9
    t = _t(0.06)
    thock = np.sin(2 * np.pi * rng.uniform(150, 230) * t) * np.exp(-t / 0.011)
    thock += bandpass(rng.standard_normal(len(t)), 250, 1600) * np.exp(-t / 0.007) * 0.7
    o = int(0.002 * RATE)
    out[o:o + len(t)] += thock
    ts = _t(0.05)
    out[o:o + len(ts)] += np.sin(2 * np.pi * rng.uniform(1800, 2700) * ts) * np.exp(-ts / 0.018) * 0.07
    rel = bandpass(rng.standard_normal(int(0.003 * RATE)), 1500, 6500) * 0.35
    r = int(rng.uniform(0.05, 0.08) * RATE)
    out[r:r + len(rel)] += rel * np.linspace(1, 0, len(rel)) ** 2
    return normalise(out, -3.0)


def classic_beep():
    """The PC-speaker POST beep."""
    x = bandpass(_tone(960, 0.22, 'square'), 80, 6000) * 0.6
    return normalise(_edges(x), -6.0)


def classic_error():
    """Old two-tone error buzzer."""
    a = bandpass(_tone(300, 0.12, 'square'), 80, 4000)
    b = bandpass(_tone(205, 0.26, 'square'), 80, 3500)
    return normalise(np.concatenate([_edges(a), np.zeros(int(0.05 * RATE)), _edges(b)]), -5.0)


def classic_poweron():
    """CRT power-on: thump, degauss hum, crackle and a faint flyback whine."""
    rng = np.random.default_rng(7)
    total = _t(2.0)
    out = np.zeros(len(total))
    t = _t(0.25)
    out[:len(t)] += np.sin(2 * np.pi * 55 * t) * np.exp(-t / 0.06) + bandpass(rng.standard_normal(len(t)), 30, 400) * np.exp(-t / 0.05) * 0.8
    td = _t(1.6)
    hum = sum(np.sin(2 * np.pi * f * td) / k for k, f in enumerate((60, 120, 180, 240), 1))
    hum *= (0.7 + 0.3 * np.sin(2 * np.pi * 9 * td)) * np.exp(-td / 0.55) * 0.55
    s = int(0.05 * RATE)
    out[s:s + len(td)] += hum
    for _ in range(14):
        p = rng.integers(0, len(out) - 60)
        out[p:p + 60] += rng.uniform(-0.6, 0.6) * np.hanning(60)
    out += np.sin(2 * np.pi * 7800 * total) * np.clip(total / 1.6, 0, 1) * 0.012
    return normalise(fade(out, 0.002, 0.3), -2.0)


def classic_hum():
    """A barely-there CRT hum loop (integer cycles, so it loops cleanly)."""
    rng = np.random.default_rng(3)
    t = _t(4.0)
    x = 0.5 * np.sin(2 * np.pi * 60 * t) + 0.25 * np.sin(2 * np.pi * 120 * t) + 0.004 * np.sin(2 * np.pi * 7800 * t)
    x += bandpass(rng.standard_normal(len(t)), 100, 2000) * 0.03
    return x


DTMF = {'1': (697, 1209), '2': (697, 1336), '3': (697, 1477), '4': (770, 1209), '5': (770, 1336),
        '6': (770, 1477), '7': (852, 1209), '8': (852, 1336), '9': (852, 1477), '0': (941, 1336)}


def classic_modem():
    """A dial-up connection: dial tone, DTMF digits, ring-back, answer tone and
    the screeching handshake — the sound of the early online world."""
    rng = np.random.default_rng(11)
    seg = []
    seg.append(_edges((_tone(350, 0.5) + _tone(440, 0.5)) * 0.4))
    seg.append(np.zeros(int(0.12 * RATE)))
    for d in '5550199':
        lo, hi = DTMF[d]
        seg += [_edges((_tone(lo, 0.075) + _tone(hi, 0.075)) * 0.45), np.zeros(int(0.05 * RATE))]
    seg.append(np.zeros(int(0.25 * RATE)))
    seg.append(_edges((_tone(440, 0.55) + _tone(480, 0.55)) * 0.3))
    seg.append(np.zeros(int(0.35 * RATE)))
    seg.append(_edges(_tone(2100, 0.55) * 0.35))
    t = _t(0.3)
    seg.append(_edges((np.sin(2 * np.pi * (1200 + 600 * np.sin(2 * np.pi * 7 * t)) * t) * 0.35)))
    t = _t(0.9)
    screech = bandpass(rng.standard_normal(len(t)), 900, 3300) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 47 * t)))
    screech += np.sin(2 * np.pi * 1650 * t) * 0.25 + np.sin(2 * np.pi * 980 * t) * 0.2
    seg.append(_edges(screech * 0.5))
    t = _t(0.7)
    seg.append(fade(bandpass(rng.standard_normal(len(t)), 600, 3400) * 0.35, 0.01, 0.2))
    x = bandpass(np.concatenate(seg), 250, 3400)
    return normalise(np.tanh(1.6 * x) / np.tanh(1.6), -3.0)


def classic_glitch(seed):
    """A burst of stuttering static for screen glitches."""
    rng = np.random.default_rng(seed)
    t = _t(rng.uniform(0.14, 0.24))
    x = bandpass(rng.standard_normal(len(t)), 400, 7000)
    x *= (np.sign(np.sin(2 * np.pi * rng.uniform(22, 40) * t)) + 1) / 2
    return normalise(fade(x, 0.002, 0.03), -6.0)


def radio_wrap(speech, seed):
    """Wraps a spoken dispatch line in an open squelch, band-limited static and
    a close squelch (plus a chance of a roger beep) — a convincing, fully
    synthetic police-radio transmission."""
    rng = np.random.default_rng(seed)
    voice = bandpass(speech, 320, 2850)
    voice = np.tanh(2.4 * voice) / np.tanh(2.4)                 # comms grit
    t = np.arange(len(voice)) / RATE
    voice *= 0.72 + 0.28 * np.sin(2 * np.pi * rng.uniform(20, 32) * t)
    for _ in range(rng.integers(2, 6)):                         # crackle
        p = rng.integers(0, max(1, len(voice) - 40))
        voice[p:p + 40] += rng.uniform(0.3, 0.8) * np.hanning(40)
    static = bandpass(rng.standard_normal(int(rng.uniform(0.06, 0.14) * RATE)), 500, 2600) * 0.35
    click = lambda ms, lo, hi: bandpass(rng.standard_normal(int(ms / 1000 * RATE)), lo, hi)
    open_c = click(10, 1500, 6000) * np.linspace(1, 0, int(0.01 * RATE)) ** 1.5
    close_c = click(7, 1200, 5000) * np.linspace(1, 0, int(0.007 * RATE)) ** 1.5
    parts = [open_c, static * 0.6, voice * 0.6, close_c]
    if rng.random() < 0.6:
        n = int(0.06 * RATE)
        beep = np.sin(2 * np.pi * rng.choice([1100, 1300, 1500]) * np.arange(n) / RATE) * np.hanning(n) * 0.3
        parts += [np.zeros(int(0.02 * RATE)), beep]
    return normalise(fade(np.concatenate(parts)), -5.0)


def main():
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    packs = {'ui': sys.argv[1], 'fx': sys.argv[2]}
    speech = sys.argv[3] if len(sys.argv) == 4 else None
    os.makedirs(OUT, exist_ok=True)
    src = lambda pack, f: os.path.join(packs[pack], f)
    spw = lambda key: os.path.join(speech, f'{key}.wav')

    # classic workstation sounds (generated)
    for i in range(1, 5):
        print(write_mp3(f'classic-key-{i}', classic_key(500 + i), '96k'))
    print(write_mp3('classic-beep', classic_beep(), '96k'))
    print(write_mp3('classic-error', classic_error(), '96k'))
    print(write_mp3('classic-poweron', classic_poweron(), '96k'))
    print(write_mp3('classic-modem', classic_modem(), '96k'))
    for i in range(1, 3):
        print(write_mp3(f'classic-glitch-{i}', classic_glitch(700 + i), '96k'))
    print(write_mp3('classic-hum', normalise(seamless(classic_hum()), -6.0), '96k'))

    if speech:
        for key in VOICE_KEYS:
            x = fade(shape(trim(load(spw(key))), VOICE_SHAPE))
            print(write_mp3(key, normalise(x, VOICE_SHAPE['peak']), '96k'))
        for key in CLASSIC_VOICE_KEYS:
            x = fade(shape(trim(load(spw(key))), CLASSIC_VOICE_SHAPE))
            print(write_mp3(key, normalise(x, CLASSIC_VOICE_SHAPE['peak']), '96k'))
        for i, key in enumerate(RADIO_KEYS, 1):
            print(write_mp3(f'radio-{i}', radio_wrap(trim(load(spw(key))), 2000 + i), '96k'))
    else:
        for i in range(1, 4):
            print(write_mp3(f'radio-{i}', radio_burst(1000 + i), '96k'))

    for name, (pack, f, opt) in ONE_SHOTS.items():
        x = fade(shape(trim(load(src(pack, f))), opt))
        print(write_mp3(name, normalise(x, opt.get('peak', -1.0)), '96k'))

    for name, layers in LAYERED.items():
        parts = [(shape(trim(load(src(p, f))), o), int(d * RATE), g) for p, f, d, g, o in layers]
        n = max(len(x) + d for x, d, _ in parts)
        mix = np.zeros(n)
        for x, d, g in parts:
            mix[d:d + len(x)] += x * g
        print(write_mp3(name, normalise(fade(mix)), '96k'))

    for name, (pack, f, opt) in LOOPS.items():
        x = shape(load(src(pack, f)), opt)
        x = normalise(seamless(x), opt.get('peak', -3.0))
        print(write_mp3(name, x, '128k'))


if __name__ == '__main__':
    main()
