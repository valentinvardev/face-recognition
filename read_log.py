with open("build_log.txt", "r", encoding="utf-16le", errors="replace") as f:
    text = f.read()
    print(text[-2000:])
