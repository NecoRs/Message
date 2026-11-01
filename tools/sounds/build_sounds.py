#!/usr/bin/env python3
"""Builds assets/sounds/*.mp3 from Kenney's CC0 sound packs.

Sources (both CC0 1.0, https://kenney.nl):
  * Interface Sounds  - https://kenney.nl/assets/interface-sounds
  * Sci-Fi Sounds     - https://kenney.nl/assets/sci-fi-sounds

Usage:
  python3 -I tools/sounds/build_sounds.py <interface-sounds-dir> <sci-fi-sounds-dir>

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

# A harsher, digital "ops-room" set: glitch keystrokes, laser-zap execute,
# metallic alarms, deep-impact errors, electric sweeps and an ominous swell.
# output name -> (pack, file, options)
ONE_SHOTS = {
    'type-1': ('ui', 'glitch_001.wav', {'peak': -5.0}),
    'type-2': ('ui', 'glitch_002.wav', {'peak': -5.0}),
    'type-3': ('ui', 'glitch_004.wav', {'peak': -5.0}),
    'type-4': ('ui', 'glitch_003.wav', {'peak': -5.0}),
    'type-5': ('ui', 'tick_002.wav', {'peak': -5.0}),
    'tick': ('ui', 'glitch_003.wav', {'peak': -4.0}),
    'row-1': ('ui', 'glitch_004.wav', {'peak': -4.0}),
    'row-2': ('ui', 'drop_002.wav', {'peak': -5.0}),
    'blip': ('ui', 'glitch_002.wav', {'peak': -3.0}),
    'success-1': ('ui', 'confirmation_002.wav', {}),
    'success-2': ('ui', 'confirmation_003.wav', {}),
    'warning': ('fx', 'impact_metal_004.ogg', {'lowpass': 2600, 'peak': -3.0}),
    'error': ('fx', 'impact_metal_002.ogg', {'lowpass': 2200, 'peak': -2.0}),
    'sweep-1': ('fx', 'force_field_000.ogg', {'peak': -3.0}),
    'sweep-2': ('fx', 'force_field_002.ogg', {'peak': -3.0}),
    'sweep-3': ('fx', 'door_open_000.ogg', {}),
    'boot': ('fx', 'low_frequency_explosion_001.ogg', {'peak': -2.0}),
}
# "digital execute": a retro laser zap with a glitch transient in front
LAYERED = {
    'execute': [('ui', 'glitch_002.wav', 0.0, 0.8), ('fx', 'laser_retro_000.ogg', 0.015, 0.9)],
}
LOOPS = {
    'loop-processing': ('fx', 'computer_noise_002.ogg', {'lowpass': 7000, 'peak': -4.0}),
    'loop-ambience': ('fx', 'space_engine_low_001.ogg', {'lowpass': 760, 'peak': -4.0}),
}


def load(path, lowpass=None):
    cmd = ['ffmpeg', '-nostdin', '-v', 'error', '-i', path]
    if lowpass:
        cmd += ['-af', f'lowpass=f={lowpass}']
    cmd += ['-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


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


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    packs = {'ui': sys.argv[1], 'fx': sys.argv[2]}
    os.makedirs(OUT, exist_ok=True)
    src = lambda pack, f: os.path.join(packs[pack], f)

    for i in range(1, 4):
        print(write_mp3(f'radio-{i}', radio_burst(1000 + i), '96k'))

    for name, (pack, f, opt) in ONE_SHOTS.items():
        x = normalise(fade(trim(load(src(pack, f)))), opt.get('peak', -1.0))
        print(write_mp3(name, x, '96k'))

    for name, layers in LAYERED.items():
        parts = [(trim(load(src(p, f))), int(d * RATE), g) for p, f, d, g in layers]
        n = max(len(x) + d for x, d, _ in parts)
        mix = np.zeros(n)
        for x, d, g in parts:
            mix[d:d + len(x)] += x * g
        print(write_mp3(name, normalise(fade(mix)), '96k'))

    for name, (pack, f, opt) in LOOPS.items():
        x = load(src(pack, f), opt.get('lowpass'))
        x = normalise(seamless(x), opt.get('peak', -3.0))
        print(write_mp3(name, x, '128k'))


if __name__ == '__main__':
    main()
