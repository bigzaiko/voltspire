"""BEATSPIRE factory buildings: one module per pair of buildings (fac_extract, fac_process, fac_make,
fac_power). Each defines MODELS, a list of builder functions named after the building (mine, pump, ...).
A module that is missing or broken is skipped with a message, so one building cannot stop the others."""
import importlib
import traceback

FACTORY = []
for _name in ('fac_extract', 'fac_process', 'fac_make', 'fac_power', 'fac_extra', 'fac_transit'):
    try:
        _mod = importlib.import_module(_name)
        importlib.reload(_mod)
        FACTORY += list(getattr(_mod, 'MODELS', []))
    except Exception:  # noqa: BLE001
        print('[factory] skipped', _name)
        traceback.print_exc()
