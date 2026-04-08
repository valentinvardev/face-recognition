with open("build_log.txt", "r", encoding="utf-16le", errors="ignore") as f:
    text = f.read()
    safe_text = text[-4000:].encode('ascii', errors='replace').decode('ascii')
    print(safe_text)
