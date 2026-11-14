from pathlib import Path
D=Path(__file__).parent
p=D/'preview.html';s=p.read_text()
s=s.replace('font-size:13px','font-size:14px').replace('#059669','#52525B').replace('#047857','#27272A')
s=s.replace('position:fixed;top:0;left:0;right:0;height:54px','position:relative;min-height:72px;box-sizing:border-box')
s=s.replace('margin:78px auto 64px','margin:24px auto 64px')
s=s.replace('👇 下方是排版效果 · 点右侧 <b>复制</b> 直接粘到公众号','本地排版预览。复制文字与样式后，须在公众号上传并替换四张图片。')
s=s.replace('max-width:150px','max-width:180px')
s=s.replace('✅ 已复制！去公众号编辑器按 Ctrl/⌘+V 粘贴即可','文字与样式已复制；本地图片须在公众号上传替换')
s=s.replace('⚠ 自动复制失败，请手动全选(Ctrl/⌘+A)再复制(Ctrl/⌘+C)','自动复制失败，请仅选中下方文章再复制；图片另行上传')
s=s.replace('box-shadow:0 3px 10px rgba(5,150,105,.28)','box-shadow:none')
p.write_text(s)
logo=Path('apps/web/public/favicon.svg').read_text()
(D/'cover.html').write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>2Space 文章封面</title><style>*{box-sizing:border-box}body{margin:0;background:#fff;font-family:"PingFang SC",sans-serif;color:#27272A}.cover{width:1200px;height:510px;padding:64px 84px;display:flex;justify-content:space-between;align-items:center}.brand{display:flex;align-items:center;gap:14px;font-size:32px;font-weight:600}.brand svg{width:64px;height:64px}h1{font-size:64px;line-height:1.3;margin:26px 0 18px;font-weight:600;letter-spacing:-1px}p{font-size:24px;color:#52525B;line-height:1.6;margin:0}.url{align-self:flex-end;font-size:22px;color:#52525B;border-top:1px solid #E4E4E7;padding-top:18px;margin-bottom:4px}.square{width:510px;height:510px;padding:46px;display:flex;flex-direction:column;justify-content:center}.square h1{font-size:46px}.square p{font-size:22px}</style><main class="cover"><section><div class="brand">'''+logo+'''<span>2Space</span></div><h1>这边复制，<br>那边就有。</h1><p>文字、清单、代码<br>换台设备接着用</p></section><div class="url">2space.cn</div></main><aside class="square"><div class="brand">'''+logo+'''<span>2Space</span></div><h1>这边复制，<br>那边就有。</h1><p>换台设备接着用<br>2space.cn</p></aside></html>''')
