import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
iems = json.load(open("app/public/data/iems.json", encoding="utf-8"))["iems"]

print("=== 1. Generic & Airline Earbuds ===")
for i in iems:
    nl = i["name"].lower()
    idl = i["id"].lower()
    if any(k in nl or k in idl for k in ["airline", "airplane", "delta", "generic", "free earbud", "cheap bud", "disposable", "plane", "flight", "fake"]):
        print(f"  • {i['name']} -> `{i['id']}`")

print("\n=== 2. Prototypes, Pre-production & Engineering Samples ===")
for i in iems:
    nl = i["name"].lower()
    idl = i["id"].lower()
    if any(k in nl or k in idl for k in ["proto", "pre-prod", "sample", "preprod", "engineering", "early unit", "test unit", "rev1", "rev 1", "beta"]):
        print(f"  • {i['name']} -> `{i['id']}`")

print("\n=== 3. Private CIEMs (Custom In-Ear Monitors) ===")
for i in iems:
    nl = i["name"].lower()
    idl = i["id"].lower()
    if "ciem" in nl or "ciem" in idl:
        print(f"  • {i['name']} -> `{i['id']}`")
    elif "custom" in nl and not any(k in nl for k in ["tip", "cable", "nozzle", "filter", "tuned"]):
        print(f"  • {i['name']} -> `{i['id']}`")

print("\n=== 4. Modder, DIY, Tape Mod, Damping & Reshells ===")
mod_keywords = ["shortbus", "modded", "tanya filter", "tape mod", "micropore", "mesh mod", "reshell", "custom tuned", " mod ", " mod", "(mod)"]
for i in iems:
    nl = i["name"].lower()
    idl = i["id"].lower()
    if any(k in nl for k in mod_keywords):
        print(f"  • {i['name']} -> `{i['id']}`")

