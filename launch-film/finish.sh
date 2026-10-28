#!/bin/bash
# Mux the master with the score, then make a 1:1 social cut and a contact sheet.
set -e
cd "$(dirname "$0")"
ffmpeg -hide_banner -loglevel error -y -i spliced.mp4 -i score_norm.wav -map 0:v -map 1:a \
  -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart Backline_launch_film_1080p60.mp4
# Square: the 16:9 frame on a soft, blurred, zoomed copy of itself.
ffmpeg -hide_banner -loglevel error -y -i Backline_launch_film_1080p60.mp4 -filter_complex \
  "[0:v]split[a][b];[a]scale=1920:1080,crop=1080:1080,boxblur=40:2,eq=brightness=0.04[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=0:(H-h)/2" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a copy -movflags +faststart Backline_launch_film_square.mp4
ffmpeg -hide_banner -loglevel error -y -i Backline_launch_film_1080p60.mp4 -vf "fps=1,scale=480:-1,tile=7x6" -frames:v 1 contact_sheet.png
ls -la Backline_launch_film_*.mp4 contact_sheet.png
