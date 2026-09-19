[Script Info]
; auto-video-edit 字幕样式模板
; 用途：作为 ASS 字幕样式参考，或直接填入字幕事件后烧录
; 烧录命令：ffmpeg -i video.mp4 -vf "ass='subtitle_style.ass'" output.mp4
;
; 字体说明：
;   macOS:   PingFang SC / Heiti SC / STHeiti
;   Windows: Microsoft YaHei / SimHei
;   Linux:   Noto Sans CJK SC / WenQuanYi Micro Hei
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 0
YCbCr Matrix: TV.709

[V4+ Styles]
; Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
; 颜色格式: &HAABBGGRR (AA=透明度 00不透明, BB=蓝, GG=绿, RR=红)
; Alignment: 1左下 2中下 3右下 / 4左中 5中中 6右中 / 7左上 8中上 9右上

; 主字幕：白色文字，黑色描边，底部居中（最常用）
Style: Default,PingFang SC,52,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,80,80,60,1

; 标题样式：加粗大字，顶部居中
Style: Title,PingFang SC,72,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,2,8,80,80,40,1

; 强调样式：黄色文字，底部居中
Style: Highlight,PingFang SC,52,&H0000FFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,1,2,80,80,60,1

; 旁白样式：灰色斜体，左下
Style: Narration,PingFang SC,44,&H00CCCCCC,&H000000FF,&H00000000,&H64000000,0,1,0,0,100,100,0,0,1,2,1,1,120,120,50,1

[Events]
; Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
; 示例事件（替换为实际字幕内容）：
; Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,这是主字幕示例
; Dialogue: 0,0:00:03.00,0:00:06.00,Default,,0,0,0,,{\c&H0000FF&}红色文字{\c}恢复正常
; Dialogue: 0,0:00:06.00,0:00:09.00,Highlight,,0,0,0,,这是强调内容
; Dialogue: 1,0:00:00.00,0:00:09.00,Narration,,0,0,0,,旁白说明文字

; ASS 控制码速查：
; {\c&HBBGGRR&}  改变文字颜色
; {\fs48}        改变字号
; {\b1}          加粗  {\b0} 取消
; {\i1}          斜体  {\i0} 取消
; {\an7}         临时改变对齐(7左上-9右上-1左下-3右下)
; {\move(x1,y1,x2,y2)} 移动字幕
; {\fad(200,300)} 淡入200ms淡出300ms
