#!/bin/bash
# Worker $1 of 2: renders its 7-second segments; a finished segment is kept across restarts.
cd "$(dirname "$0")"
for i in 0 1 2 3 4 5; do
  [ $((i % 2)) -eq "$1" ] || continue
  out=seg/s$i.mp4
  [ -f "$out" ] && continue
  node render.mjs seg/tmp$i.mp4 60 4 $((i*7)) $((i*7+7)) > seg/log$i.txt 2>&1 && mv seg/tmp$i.mp4 "$out"
  echo "segment $i done"
done
