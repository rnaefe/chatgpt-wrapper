"""Original 120 BPM demo score. Requires NumPy; no samples or network calls."""
from pathlib import Path
import wave
import numpy as np

RATE, SECONDS, BEAT = 48000, 40, 0.5
rng = np.random.default_rng(731)
mix = np.zeros((RATE * SECONDS, 2), dtype=np.float64)

def add(start, sound, gain=1, pan=0):
    offset = round(start * RATE)
    length = min(len(sound), len(mix) - offset)
    if length <= 0:
        return
    mix[offset:offset+length, 0] += sound[:length] * gain * np.sqrt((1-pan)/2)
    mix[offset:offset+length, 1] += sound[:length] * gain * np.sqrt((1+pan)/2)

def time(duration):
    return np.arange(round(RATE * duration)) / RATE

def note(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def pluck(midi, duration=0.4):
    t = time(duration)
    f = note(midi)
    envelope = (1-np.exp(-t*240)) * np.exp(-t*9)
    return (np.sin(2*np.pi*f*t) + .24*np.sin(2*np.pi*f*2*t)) * envelope

# D minor / B-flat / F / C. The score resolves over the final title.
roots = [38, 34, 41, 36]
for bar in range(20):
    start, root = bar * 2, roots[bar % 4]
    t = time(2.6)
    attack = np.minimum(t/.22, 1) * np.minimum((2.6-t)/.6, 1)
    chord = [0, 3 if bar % 4 == 0 else 4, 7, 14]
    pad = sum(np.sin(2*np.pi*note(root+12+step)*t + .008*np.sin(2*np.pi*.4*t)) for step in chord)
    add(start, pad * attack, .045, (-1)**bar * .3)
    for step in range(8):
        midi = root + 24 + [0, 7, 12, 3 if bar % 4 == 0 else 4, 14, 7, 12, 7][step]
        add(start + step*.25, pluck(midi), .10 if start >= 4 else .055, (-1)**step * .45)

for beat in range(8, 76):
    start = beat * BEAT
    t = time(.38)
    kick = np.sin(2*np.pi*(46*t + 9*(1-np.exp(-t*35)))) * np.exp(-t*13)
    kick += .10*rng.normal(size=len(t))*np.exp(-t*180)
    add(start, kick, .62)
    root = roots[(beat // 4) % 4]
    tb = time(.37)
    bass = np.tanh(1.5*(np.sin(2*np.pi*note(root)*tb) + .2*np.sin(4*np.pi*note(root)*tb)))
    sidechain = (1-np.exp(-tb*32))*np.exp(-tb*6)
    add(start+.025, bass*sidechain, .25)
    if beat % 2 == 1:
        ts = time(.16)
        noise = rng.normal(size=len(ts))
        snap = noise * np.exp(-ts*27) + .2*np.sin(2*np.pi*180*ts)*np.exp(-ts*35)
        add(start, snap, .14)
    for sub in [0, .25]:
        th = time(.06)
        noise = rng.normal(size=len(th))
        hat = np.diff(noise, prepend=0)*np.exp(-th*85)
        add(start+sub, hat, .032 if sub else .045, -.3 if sub else .3)

for cut in [4, 10, 18, 24, 30, 36]:
    t = time(.7)
    noise = rng.normal(size=len(t))
    add(cut-.7, noise * (t/.7)**3 * .08, 1, -.2)
    add(cut, pluck(86, .65), .2, .4)
for start in [18, 36]:
    for index, midi in enumerate([74, 77, 81, 86]):
        add(start+index*.08, pluck(midi, 1.2), .12, -.4+index*.25)

t = np.arange(len(mix))/RATE
fade = np.minimum(t/.25, 1)*np.minimum((SECONDS-t)/1.2, 1)
mix = np.tanh(mix*1.25)*fade[:, None]
mix *= .88 / np.max(np.abs(mix))
destination = Path(__file__).resolve().parents[1] / "out" / "score.wav"
destination.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(destination), "wb") as audio:
    audio.setnchannels(2)
    audio.setsampwidth(2)
    audio.setframerate(RATE)
    audio.writeframes((mix*32767).astype('<i2').tobytes())
print(destination)
