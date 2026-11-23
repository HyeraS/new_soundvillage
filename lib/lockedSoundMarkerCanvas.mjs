export function drawLockedSoundMarker(ctx, x, y) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = 'rgba(44, 52, 68, .9)'
  ctx.strokeStyle = '#697386'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, -11); ctx.lineTo(9, -5); ctx.lineTo(9, 6)
  ctx.lineTo(0, 11); ctx.lineTo(-9, 6); ctx.lineTo(-9, -5)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = '#d1d5db'
  ctx.fillStyle = '#d1d5db'
  ctx.lineWidth = 1.7
  ctx.beginPath()
  ctx.arc(0, -2, 3.2, Math.PI, 0)
  ctx.stroke()
  ctx.fillRect(-4.2, -2, 8.4, 7)
  ctx.fillStyle = '#4b5563'
  ctx.fillRect(-1, .5, 2, 2.5)
  ctx.restore()
}
