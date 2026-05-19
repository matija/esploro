#!/usr/bin/env swift
//
// build-app-store-icon.swift
//
// Produces the App Store-compliant 1024x1024 icon from the existing
// rounded-corner source icon (src-tauri/icons/icon.png).
//
// App Store Connect requires:
//   - exactly 1024x1024 px
//   - PNG with no alpha channel
//   - no rounded corners (Apple applies its own rounded-rectangle mask)
//
// Strategy: composite the source onto a solid square background coloured
// to match the source's own corner-most gradient pixel. We find the most-
// corner-ward fully-opaque pixel along each of the four corner diagonals
// (these sit exactly on the source's rounded-rect edge, where the gradient
// is darkest) and average them for the background fill. CGContext's alpha
// blending then handles the rounded-rect anti-aliased edge cleanly, and
// because the fill colour matches the gradient where the rounded rect
// meets the corner, Apple's icon mask cannot expose a visible fringe
// regardless of how its radius compares to the source's.
//
// Usage:
//   swift build-app-store-icon.swift <input.png> <output.png>

import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: build-app-store-icon.swift <input.png> <output.png>\n".utf8))
    exit(2)
}

let inPath = CommandLine.arguments[1]
let outPath = CommandLine.arguments[2]

guard let inputData = try? Data(contentsOf: URL(fileURLWithPath: inPath)),
      let inputImage = NSImage(data: inputData),
      let inputCG = inputImage.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    FileHandle.standardError.write(Data("error: failed to load input image at \(inPath)\n".utf8))
    exit(1)
}

let size = 1024
guard inputCG.width == size, inputCG.height == size else {
    FileHandle.standardError.write(Data("error: input image must be \(size)x\(size), got \(inputCG.width)x\(inputCG.height)\n".utf8))
    exit(1)
}

let colorSpace = CGColorSpaceCreateDeviceRGB()
let bytesPerRow = size * 4

// Read the source into a pixel buffer once so we can sample arbitrary
// coordinates without going through CGContext.draw per sample (which is
// silently slow on this Apple Silicon machine).
var pixels = [UInt8](repeating: 0, count: size * bytesPerRow)
guard let readCtx = pixels.withUnsafeMutableBytes({ buf -> CGContext? in
    CGContext(
        data: buf.baseAddress,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
}) else {
    FileHandle.standardError.write(Data("error: failed to create read CGContext\n".utf8))
    exit(1)
}
readCtx.draw(inputCG, in: CGRect(x: 0, y: 0, width: size, height: size))

@inline(__always) func offset(_ x: Int, _ y: Int) -> Int { (y * size + x) * 4 }

// Walk inward along the diagonal from a corner until we hit a fully-opaque
// pixel. That's the gradient colour right at the rounded-rect edge —
// exactly the colour the corner would have if the rect weren't rounded.
struct Sample { let r: Double; let g: Double; let b: Double }
func sampleCorner(cornerX: Int, cornerY: Int) -> Sample {
    let stepX = cornerX == 0 ? 1 : -1
    let stepY = cornerY == 0 ? 1 : -1
    var x = cornerX
    var y = cornerY
    while x >= 0 && x < size && y >= 0 && y < size {
        let idx = offset(x, y)
        if pixels[idx + 3] == 255 {
            return Sample(
                r: Double(pixels[idx])     / 255.0,
                g: Double(pixels[idx + 1]) / 255.0,
                b: Double(pixels[idx + 2]) / 255.0
            )
        }
        x += stepX
        y += stepY
    }
    return Sample(r: 0, g: 0, b: 0)
}

let cornerSamples = [
    sampleCorner(cornerX: 0,        cornerY: 0),
    sampleCorner(cornerX: size - 1, cornerY: 0),
    sampleCorner(cornerX: 0,        cornerY: size - 1),
    sampleCorner(cornerX: size - 1, cornerY: size - 1),
]
let count = Double(cornerSamples.count)
let bgR = cornerSamples.map(\.r).reduce(0, +) / count
let bgG = cornerSamples.map(\.g).reduce(0, +) / count
let bgB = cornerSamples.map(\.b).reduce(0, +) / count
print(String(format: "sampled rounded-rect edge colour: r=%.3f g=%.3f b=%.3f (#%02x%02x%02x)",
             bgR, bgG, bgB,
             Int(bgR * 255), Int(bgG * 255), Int(bgB * 255)))

// Render: solid background + source on top, into a no-alpha bitmap so the
// output PNG carries no alpha channel.
guard let outCtx = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else {
    FileHandle.standardError.write(Data("error: failed to create output CGContext\n".utf8))
    exit(1)
}

outCtx.setFillColor(red: bgR, green: bgG, blue: bgB, alpha: 1.0)
outCtx.fill(CGRect(x: 0, y: 0, width: size, height: size))
outCtx.draw(inputCG, in: CGRect(x: 0, y: 0, width: size, height: size))

guard let outCG = outCtx.makeImage() else {
    FileHandle.standardError.write(Data("error: failed to make output image\n".utf8))
    exit(1)
}

let rep = NSBitmapImageRep(cgImage: outCG)
guard let pngData = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("error: failed to encode PNG\n".utf8))
    exit(1)
}

try pngData.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath) (\(pngData.count) bytes, no alpha channel)")
