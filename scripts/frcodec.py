"""Packing of catalog curves (iems.json, headphones.json), exact to the tenth of a dB.

  "~" + base64(int16 first value, then int8 steps between neighbouring points)   usual form
  base64(int16 values)                                                            if a step is > 12.7 dB

On the 1/24-octave grid neighbouring points almost never differ by more than 12.7 dB, so the step
form is about a third the size of plain JSON numbers and quick for the app to parse;
src/audio/data.ts decodes both. Older files with plain number lists still read.
"""
import base64

import numpy as np


def encode(tenths) -> str:
    v = np.asarray(tenths, dtype=np.int64)
    steps = np.diff(v)
    if len(v) and np.all(np.abs(steps) <= 127):
        return "~" + base64.b64encode(np.int16(v[0]).astype("<i2").tobytes() + steps.astype("i1").tobytes()).decode("ascii")
    return base64.b64encode(v.astype("<i2").tobytes()).decode("ascii")


def decode(fr) -> np.ndarray:
    if isinstance(fr, str):
        if fr.startswith("~"):  # never a base64 character
            raw = base64.b64decode(fr[1:])
            first = np.frombuffer(raw[:2], dtype="<i2")[0]
            return np.concatenate([[first], first + np.cumsum(np.frombuffer(raw[2:], dtype="i1").astype(np.int64))]).astype(float)
        return np.frombuffer(base64.b64decode(fr), dtype="<i2").astype(float)
    return np.asarray(fr, float)
