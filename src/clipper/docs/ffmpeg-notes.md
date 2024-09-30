# FFmpeg Notes

## Global Encode Options
b
Set bitrate target in bits/second. By default this will use variable-bitrate mode. If maxrate and minrate are also set to the same value then it will use constant-bitrate mode, otherwise if crf is set as well then it will use constrained-quality mode.

g integer (encoding,video)
Set the group of picture (GOP) size. Default value is 12.

bf integer (encoding,video)
Set max number of B frames between non-B-frames.

Must be an integer between -1 and 16. 0 means that B-frames are disabled. If a value of -1 is used, it will choose an automatic value depending on the encoder.

Default value is 0.

When not using crf and target max bit rate

bufsize integer (encoding,audio,video)
Set ratecontrol buffer size (in bits).

maxrate integer (encoding,audio,video)
Set max bitrate tolerance (in bits/s). Requires bufsize to be set.

maxrate/bufsize = frequency of checks

## Vulkan

### h264

h264_vulkan AVOptions:
  -idr_interval      <int>        E..V....... Distance (in I-frames) between key frames (from 0 to INT_MAX) (default 0)
  -b_depth           <int>        E..V....... Maximum B-frame reference depth (from 1 to INT_MAX) (default 1)
  -async_depth       <int>        E..V....... Maximum processing parallelism. Increase this to improve single channel performance. (from 1 to 64) (default 2)
  -qp                <int>        E..V....... Use an explicit constant quantizer for the whole stream (from -1 to 255) (default -1)
  -quality           <int>        E..V....... Set encode quality (trades off against speed, higher is faster) (from 0 to INT_MAX) (default 0)
  -rc_mode           <int>        E..V....... Select rate control type (from 0 to UINT32_MAX) (default auto)
     auto            4294967295   E..V....... Choose mode automatically based on parameters
     driver          0            E..V....... Driver-specific rate control
     cqp             1            E..V....... Constant quantizer mode
     cbr             2            E..V....... Constant bitrate mode
     vbr             4            E..V....... Variable bitrate mode
  -tune              <int>        E..V....... Select tuning type (from 0 to INT_MAX) (default default)
     default         0            E..V....... Default tuning
     hq              1            E..V....... High quality tuning
     ll              2            E..V....... Low-latency tuning
     ull             3            E..V....... Ultra low-latency tuning
     lossless        4            E..V....... Lossless mode tuning
  -usage             <flags>      E..V....... Select usage type (default 0)
     default                      E..V....... Default optimizations
     transcode                    E..V....... Optimize for transcoding
     stream                       E..V....... Optimize for streaming
     record                       E..V....... Optimize for offline recording
     conference                   E..V....... Optimize for teleconferencing
  -content           <flags>      E..V....... Select content type (default 0)
     default                      E..V....... Default content
     camera                       E..V....... Camera footage
     desktop                      E..V....... Screen recording
     rendered                     E..V....... Game or 3D content
  -profile           <int>        E..V....... Set profile (profile_idc and constraint_set*_flag) (from -99 to 65535) (default -99)
     constrained_baseline 578          E..V.......
     main            77           E..V.......
     high            100          E..V.......
     high444p        110          E..V.......
  -level             <int>        E..V....... Set level (level_idc) (from -99 to 255) (default -99)
    ...
  -coder             <int>        E..V....... Entropy coder type (from 0 to 1) (default cabac)
     cabac           1            E..V.......
     vlc             0            E..V.......
  -units             <flags>      E..V....... Set units to include (default aud+identifier+timing+recovery+a53_cc)
     aud                          E..V....... Include AUD units
     identifier                   E..V....... Include encoder version identifier
     timing                       E..V....... Include timing parameters (buffering_period and pic_timing)
     recovery                     E..V....... Include recovery points where appropriate
     a53_cc                       E..V....... Include A/53 caption data
