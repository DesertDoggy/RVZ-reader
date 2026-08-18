# rvz-reader

Convert Dolphin `.rvz` GameCube/Wii disc images to raw `.iso` images.

## Usage

```
rvz2iso.exe <input.rvz> [output.iso]
```

If `output.iso` is omitted, it defaults to the input path with its extension
replaced by `.iso`.

```
rvz2iso.exe "Game.rvz"
rvz2iso.exe "Game.rvz" "D:\output\game.iso"
```

## License

MIT — see [LICENSE](LICENSE).

