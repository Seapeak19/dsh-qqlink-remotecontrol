import argparse
import json
import os
import subprocess
import sys
import threading
import time
import wave
from datetime import datetime
from pathlib import Path

_CONSOLE = Path(__file__).resolve().parent
sys.path.append(str(_CONSOLE / "pylibs"))
import numpy as np
from PIL import ImageGrab

try:
    import soundcard as sc
except Exception:
    sc = None

ROOT = _CONSOLE.parent
OUT = _CONSOLE / "data" / "perception"
LATEST = OUT / "latest.jpg"
STATUS = OUT / "status.json"
TRANSCRIPT = OUT / "transcript.jsonl"
STOP = OUT / "stop.flag"
PID = OUT / "pid"
LOG = OUT / "perception.log"
STT = _CONSOLE / "stt.ps1"
POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

lock = threading.Lock()
status = {}


def iso():
    return datetime.now().isoformat(timespec="seconds")


def log(msg):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"[{iso()}] {msg}\n")
    except Exception:
        pass


def save_status_locked():
    status["updated"] = iso()
    tmp = OUT / "status.tmp"
    tmp.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATUS)


def save_status():
    with lock:
        save_status_locked()


def set_error(msg):
    with lock:
        status["lastError"] = str(msg)[:300]
        save_status_locked()


def transcribe(wav_path):
    json_path = OUT / f"stt-{int(time.time() * 1000)}.json"
    try:
        subprocess.run(
            [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(STT), "-Wav", str(wav_path), "-OutJson", str(json_path)],
            capture_output=True, text=True, encoding="utf-8", timeout=90,
            creationflags=0x08000000,
        )
        if not json_path.exists():
            set_error("STT 没有输出")
            return ""
        obj = json.loads(json_path.read_text(encoding="utf-8"))
        if not obj.get("ok"):
            set_error(obj.get("error") or "STT 失败")
            return ""
        warning = str(obj.get("warning") or "").strip()
        if warning:
            log("STT warning: " + warning[:200])
        items = obj.get("items") or []
        return " ".join(str(x.get("text") or "") for x in items).strip()
    except Exception as e:
        set_error("STT: " + str(e))
        return ""
    finally:
        try:
            json_path.unlink()
        except Exception:
            pass


def vision_loop(args):
    frame = 0
    while not STOP.exists():
        t0 = time.time()
        try:
            img = ImageGrab.grab(all_screens=True)
            w, h = img.size
            img.thumbnail((1280, 1280))
            tmp = OUT / "latest.tmp.jpg"
            img.convert("RGB").save(tmp, "JPEG", quality=70)
            os.replace(tmp, LATEST)
            frame += 1
            with lock:
                status["frames"] = frame
                status["screen"] = [w, h]
                status["visionAt"] = iso()
                save_status_locked()
            if frame % 15 == 0:
                key = OUT / f"key-{int(time.time())}.jpg"
                img.convert("RGB").save(key, "JPEG", quality=65)
                old = sorted(OUT.glob("key-*.jpg"))
                for p in old[:-12]:
                    try:
                        p.unlink()
                    except Exception:
                        pass
        except Exception as e:
            set_error("截图: " + str(e))
        elapsed = time.time() - t0
        time.sleep(max(0.2, args.interval - elapsed))


def audio_loop(args):
    if not args.audio:
        return
    if sc is None:
        set_error("soundcard 不可用")
        return
    try:
        speaker = sc.default_speaker()
        mic = sc.get_microphone(id=str(speaker.name), include_loopback=True)
        with mic.recorder(samplerate=16000, channels=1) as rec:
            while not STOP.exists():
                data = rec.record(numframes=16000 * args.chunk)
                if STOP.exists():
                    break
                pcm = np.asarray(data).reshape(-1)
                pcm = np.clip(pcm, -1, 1)
                pcm = (pcm * 32767).astype(np.int16)
                if len(pcm) < 8000:
                    continue
                wav = OUT / f"chunk-{int(time.time())}.wav"
                with wave.open(str(wav), "wb") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(16000)
                    w.writeframes(pcm.tobytes())
                text = transcribe(wav)
                try:
                    wav.unlink()
                except Exception:
                    pass
                if text:
                    with lock:
                        with open(TRANSCRIPT, "a", encoding="utf-8") as f:
                            f.write(json.dumps({"ts": iso(), "text": text}, ensure_ascii=False) + "\n")
                        status["transcripts"] = int(status.get("transcripts", 0)) + 1
                        status["lastText"] = text
                        status["audioAt"] = iso()
                        save_status_locked()
                    log("STT: " + text)
    except Exception as e:
        set_error("录音: " + str(e))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="pc")
    ap.add_argument("--seconds", type=int, default=0, help="0 = 一直跑")
    ap.add_argument("--interval", type=float, default=1.5)
    ap.add_argument("--chunk", type=float, default=5.0)
    ap.add_argument("--no-audio", action="store_true")
    args = ap.parse_args()
    args.audio = not args.no_audio

    OUT.mkdir(parents=True, exist_ok=True)
    try:
        STOP.unlink()
    except Exception:
        pass
    TRANSCRIPT.write_text("", encoding="utf-8")
    PID.write_text(str(os.getpid()), encoding="utf-8")

    with lock:
        status.clear()
        status.update({
            "running": True,
            "mode": args.mode,
            "started": iso(),
            "updated": iso(),
            "frames": 0,
            "transcripts": 0,
            "lastText": "",
            "screen": [0, 0],
            "audio": args.audio,
            "audioError": "",
            "lastError": "",
            "pid": os.getpid(),
        })
        save_status_locked()

    log(f"start mode={args.mode} seconds={args.seconds} audio={args.audio}")
    threads = [threading.Thread(target=vision_loop, args=(args,), daemon=True)]
    if args.audio:
        threads.append(threading.Thread(target=audio_loop, args=(args,), daemon=True))
    for t in threads:
        t.start()

    started = time.time()
    try:
        while True:
            if STOP.exists():
                break
            if args.seconds and time.time() - started >= args.seconds:
                break
            time.sleep(0.5)
    finally:
        try:
            STOP.write_text("stop", encoding="utf-8")
        except Exception:
            pass
        for t in threads:
            t.join(timeout=8)
        with lock:
            status["running"] = False
            status["stopped"] = iso()
            save_status_locked()
        log("stop")
        try:
            PID.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    main()