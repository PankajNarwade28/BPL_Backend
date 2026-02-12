import argparse
from pathlib import Path
import sys

"""
Replace spaces with underscores in image filenames within a folder.
PRE-CONFIGURED FOR: C:/Users/Rohitbhagat/Downloads/Question
(Using forward slashes to avoid escape sequence errors)
"""

IMAGE_EXTS = {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".svg", ".heic"
}

def is_image_file(p: Path) -> bool:
        return p.is_file() and p.suffix.lower() in IMAGE_EXTS

def unique_target(path: Path) -> Path:
        if not path.exists():
                return path
        stem = path.stem
        suf = path.suffix
        parent = path.parent
        i = 1
        while True:
                candidate = parent / f"{stem}_{i}{suf}"
                if not candidate.exists():
                        return candidate

def main():
        parser = argparse.ArgumentParser(description="Replace spaces with underscores in image filenames.")
        parser.add_argument("--dir", "-d", default="C:/Users/Rohitbhagat/Downloads/Question", 
                           help="Directory to process (default: Downloads/Question)")
        parser.add_argument("--recursive", "-r", action="store_true", help="Search directories recursively")
        parser.add_argument("--dry-run", action="store_true", help="Show what would be renamed without making changes")
        args = parser.parse_args()

        base = Path(args.dir)
        if not base.exists() or not base.is_dir():
                print(f"Directory not found: {base}", file=sys.stderr)
                sys.exit(1)

        print(f"Processing directory: {base}")
        iterator = base.rglob("*") if args.recursive else base.iterdir()
        renamed = 0
        for p in iterator:
                try:
                        if not is_image_file(p):
                                continue
                        if " " not in p.name:
                                continue
                        new_name = p.name.replace(" ", "_")
                        target = p.with_name(new_name)
                        if target.exists():
                                target = unique_target(target)
                        if args.dry_run:
                                print(f"[DRY] {p} -> {target}")
                        else:
                                p.rename(target)
                                print(f"✓ Renamed: {p.name} -> {target.name}")
                        renamed += 1
                except Exception as e:
                        print(f"✗ Skipping {p}: {e}", file=sys.stderr)

        print(f"\n✅ Done. {renamed} file(s) processed.")

if __name__ == "__main__":
        main()
