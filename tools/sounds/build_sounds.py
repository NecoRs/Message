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

# output name -> (pack, file, options)
ONE_SHOTS = {
    'type-1': ('ui', 'click_002.wav', {}),
    'type-2': ('ui', 'click_003.wav', {}),
    'type-3': ('ui', 'click_004.wav', {}),
    'type-4': ('ui', 'click_005.wav', {}),
    'type-5': ('ui', 'tick_002.wav', {}),
    'tick': ('ui', 'tick_001.wav', {}),
    'row-1': ('ui', 'select_001.wav', {}),
    'row-2': ('ui', 'select_002.wav', {}),
    'blip': ('ui', 'pluck_001.wav', {}),
    'success-1': ('ui', 'confirmation_002.wav', {}),
    'success-2': ('ui', 'confirmation_003.wav', {}),
    'warning': ('ui', 'question_002.wav', {}),
    'error': ('ui', 'error_006.wav', {}),
    'sweep-1': ('ui', 'maximize_004.wav', {}),
    'sweep-2': ('ui', 'maximize_006.wav', {}),
    'sweep-3': ('fx', 'door_open_000.ogg', {}),
    'boot': ('fx', 'force_field_000.ogg', {'peak': -3.0}),
}
# "digital execute": a short glitch with a select blip 25 ms later
LAYERED = {
    'execute': [('ui', 'glitch_001.wav', 0.0, 1.0), ('ui', 'select_002.wav', 0.025, 0.8)],
}
LOOPS = {
    'loop-processing': ('fx', 'computer_noise_000.ogg', {'lowpass': 7000, 'peak': -4.0}),
    'loop-ambience': ('fx', 'space_engine_low_001.ogg', {'lowpass': 900, 'peak': -3.0}),
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


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    packs = {'ui': sys.argv[1], 'fx': sys.argv[2]}
    os.makedirs(OUT, exist_ok=True)
    src = lambda pack, f: os.path.join(packs[pack], f)

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
