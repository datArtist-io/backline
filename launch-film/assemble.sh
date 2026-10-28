#!/bin/bash
set -e
cd "$(dirname "$0")"
for i in 0 1 2 3 4 5; do echo "file 's$i.mp4'"; done > seg/list.txt
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i seg/list.txt -c copy spliced.mp4
ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 spliced.mp4
bash finish.sh
