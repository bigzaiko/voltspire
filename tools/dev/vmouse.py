# A virtual mouse driven by lines on stdin: "move <counts> <rate> <dx>", "click left|right", "quit". Answers "ok" per line.
import sys, time
from evdev import UInput, ecodes as e
ui = UInput({e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL], e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE]}, name='Beatspire test mouse', vendor=0x1209, product=0x0001, version=1)
print('ready', flush=True)
for line in sys.stdin:
    a = line.split()
    if not a: continue
    if a[0] == 'move':
        counts, rate, dx = int(a[1]), float(a[2]), int(a[3])
        iv = 1.0 / rate; t = time.perf_counter()
        for _ in range(counts):
            ui.write(e.EV_REL, e.REL_X, dx); ui.syn()
            t += iv; d = t - time.perf_counter()
            if d > 0: time.sleep(d)
    elif a[0] == 'click':
        b = e.BTN_RIGHT if a[1] == 'right' else e.BTN_LEFT
        ui.write(e.EV_KEY, b, 1); ui.syn(); time.sleep(0.06); ui.write(e.EV_KEY, b, 0); ui.syn()
    elif a[0] == 'quit': break
    print('ok', flush=True)
ui.close()
