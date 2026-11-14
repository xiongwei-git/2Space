from pathlib import Path
import re,html
D=Path(__file__).parent
T=Path('/Users/tedxiong/.codex/skills/gzh-design/references/theme-graphite-minimal.md').read_text()
def component(heading,n=0):
 s=T.split(heading,1)[1];s=s.split('\n## ',1)[0]
 return re.findall(r'```html\n(.*?)```',s,re.S)[n].strip()
def leaf(s):return '<span leaf="">'+html.escape(s)+'</span>'
U='border-bottom:2px solid #52525B;font-weight:600;color:#27272A;'
def inline(s):
 parts=re.split(r'(\*\*.*?\*\*)',s)
 return ''.join('<span style="'+U+'">'+leaf(p[2:-2])+'</span>' if p.startswith('**') else leaf(p) for p in parts if p)
# Source components 2, 3, 4, 5, 6, 7d, 14, 15, 16; no unrelated theme fragments.
para=component('## 组件 6 正文段落',1)
def paragraph(s):
 if '**' not in s:
  # One semantic phrase per ordinary paragraph, with deliberate exceptions.
  keys=['手机上复制','同一个空间','随机体验','已保存','主动粘贴','轻量富文本','复制代码原文','下载为文字文件','复制链接','阅读模式','整个空间设置密码','密码忘记无法找回','只要三步','专注文字','少一点来回折腾']
  for k in keys:
   if k in s:s=s.replace(k,'**'+k+'**',1);break
 return re.sub(r'\s*<span leaf="">{{前半句}}</span>.*?<span leaf="">{{后半句}}</span>',lambda m:inline(s),para,flags=re.S)
intro=component('## 组件 2 开头引言卡片')
intro=re.sub(r'\s*<p style="text-align:right.*?</p>','',intro,flags=re.S)
intro=intro.replace('{{金句前段}}','让一段内容，').replace('{{石墨下划线关键词}}','少走几次中转').replace('{{金句收尾}}','。')
nav=component('## 组件 3 前言导读区域')
for k,v in zip(['看点一','看点二','看点三'],['换台设备接着用','文字与代码','分享与访问']):nav=nav.replace('{{'+k+'}}',v)
head=component('## 组件 5 章节标题')
sep=component('## 组件 4 章节分割线')
img=component('## 组件 14 图片容器')
cap='<p style="font-size:14px;color:#52525B;text-align:center;margin:0 10px 28px;letter-spacing:0.5px;">{}</p>'
sections=[];pre=[];current=None
md=(D/'article.md').read_text()
for block in md.strip().split('\n\n'):
 if block.startswith('# ') or block.startswith('> ') or block=='---':continue
 if block.startswith('我是 '):break
 if block.startswith('## '):
  current=[block[3:],[]];sections.append(current);continue
 if block.startswith('!['):
  alt,src=re.match(r'!\[(.*?)\]\((.*?)\)',block).groups()
  rendered=img.replace('{{图片URL}}',src).replace('<img src=',f'<img alt="{html.escape(alt)}" src=')+cap.format(leaf('— '+alt))
 else:rendered=paragraph(block)
 (pre if current is None else current[1]).append(rendered)
out=[intro,'<section style="padding:0 10px;">'+''.join(pre)+'</section>',nav]
for i,(title,blocks) in enumerate(sections):
 h=head.replace('01','∞' if i==len(sections)-1 else f'{i+1:02}').replace('{{中文章节标题}}',title).replace('{{ENGLISH TAG}}',['CONTINUE','TEXT & CODE','SHARE','TRY IT'][i])
 if i==0:h=h.replace('margin-top:56px','margin-top:16px')
 h=h.replace('<!-- 本章节正文内容放在这里 -->',''.join(blocks))
 out.append(h)
 if i<len(sections)-1:out.append(sep)
out.append(component('## 组件 15 END 结尾分割线'))
sign=component('## 组件 16 尾部作者签名区').replace('{{一句话简介，如：热衷于分享 AI 观察与干货}}','{{简介}}')
out.append(sign)
container=component('## 组件 1 全局容器')
s=container.replace('<!-- 所有组件放在这里 -->','\n'.join(out))
# User-approved reading baseline overrides conflicting template defaults.
s=s.replace('font-size:15px','font-size:1rem').replace('font-size:48px','font-size:24px').replace('font-size:32px','font-size:24px')
for n in [10,11,12,13]:s=s.replace(f'font-size:{n}px','font-size:0.875rem')
s=s.replace('#A1A1AA','#52525B').replace('#71717A','#52525B').replace('text-align:justify','text-align:left')
s=s.replace('color:#E4E4E7','color:#52525B')
# Meaningful chapter numbers and labels meet the contrast baseline.
(D/'article_排版_石墨极简风(graphite-minimal).html').write_text(s)
(D/'titles.md').write_text('''# 标题与摘要\n\n推荐：别再给自己发消息了，试试这个跨设备剪贴板\n\n备选一：这边复制，那边就有：用 2Space 接住零散文字\n\n备选二：清单、摘录、代码，换台设备接着用\n\n摘要：不用注册或安装，把文字、清单和代码放进同一个空间，换台设备继续使用。认识一下轻量在线剪贴板 2Space。\n''')
print('Assembled',len(s),'characters')
