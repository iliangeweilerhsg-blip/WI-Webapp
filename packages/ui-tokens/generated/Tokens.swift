// GENERIERT aus tokens.json – nicht von Hand ändern. Neu erzeugen: pnpm --filter @sg/ui-tokens gen
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public enum Tokens {
    /// Farbe, die automatisch zwischen Hell und Dunkel wechselt.
    public static func dynamic(light: UInt32, dark: UInt32) -> Color {
        #if canImport(UIKit)
        return Color(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
        #else
        return Color(hex: light)
        #endif
    }

    public enum Colors {
        public static let bg = Tokens.dynamic(light: 0xFFFFFF, dark: 0x161618)
        public static let surface = Tokens.dynamic(light: 0xF4F4F5, dark: 0x232326)
        public static let surfaceRaised = Tokens.dynamic(light: 0xFFFFFF, dark: 0x2C2C30)
        public static let border = Tokens.dynamic(light: 0xE4E4E7, dark: 0x3A3A3F)
        public static let borderStrong = Tokens.dynamic(light: 0x80808A, dark: 0x8B8B94)
        public static let text = Tokens.dynamic(light: 0x18181B, dark: 0xF4F4F5)
        public static let textMuted = Tokens.dynamic(light: 0x52525B, dark: 0xA1A1AA)
        public static let accent = Tokens.dynamic(light: 0x2F5DE0, dark: 0x8DA6FF)
        public static let accentContrast = Tokens.dynamic(light: 0xFFFFFF, dark: 0x0B1020)
        public static let accentSoft = Tokens.dynamic(light: 0xE8EDFC, dark: 0x25304F)
        public static let record = Tokens.dynamic(light: 0xC42B1C, dark: 0xFF6B5B)
        public static let danger = Tokens.dynamic(light: 0xC42B1C, dark: 0xFF6B5B)
    }

    /// Modulfarben mod-01 bis mod-12 (07 §8).
    public enum Module {
        public static let mod01 = Tokens.dynamic(light: 0x355A8D, dark: 0x94B2DB)
        public static let mod02 = Tokens.dynamic(light: 0x2D7076, dark: 0x94D5DB)
        public static let mod03 = Tokens.dynamic(light: 0x2B734F, dark: 0x94DBB8)
        public static let mod04 = Tokens.dynamic(light: 0x49732B, dark: 0xB2DB94)
        public static let mod05 = Tokens.dynamic(light: 0x6F5A2A, dark: 0xDBC694)
        public static let mod06 = Tokens.dynamic(light: 0x8D5535, dark: 0xDBAE94)
        public static let mod07 = Tokens.dynamic(light: 0x7E444E, dark: 0xD6A4AC)
        public static let mod08 = Tokens.dynamic(light: 0x8D3552, dark: 0xDB94AC)
        public static let mod09 = Tokens.dynamic(light: 0x8D358D, dark: 0xDB94DB)
        public static let mod10 = Tokens.dynamic(light: 0x5A358D, dark: 0xB294DB)
        public static let mod11 = Tokens.dynamic(light: 0x353D8D, dark: 0x949ADB)
        public static let mod12 = Tokens.dynamic(light: 0x55656D, dark: 0xABBCC4)
        public static let all: [Color] = [mod01, mod02, mod03, mod04, mod05, mod06, mod07, mod08, mod09, mod10, mod11, mod12]
    }

    public enum Space {
        public static let s1: CGFloat = 4
        public static let s2: CGFloat = 8
        public static let s3: CGFloat = 12
        public static let s4: CGFloat = 16
        public static let s6: CGFloat = 24
        public static let s8: CGFloat = 32
    }

    public enum Radius {
        public static let sm: CGFloat = 4
        public static let md: CGFloat = 8
        public static let lg: CGFloat = 12
        public static let full: CGFloat = 9999
    }

    public enum FontSize {
        public static let xs: CGFloat = 12
        public static let sm: CGFloat = 14
        public static let md: CGFloat = 16
        public static let lg: CGFloat = 18
        public static let xl: CGFloat = 22
        public static let xxl: CGFloat = 28
        public static let cardMin: CGFloat = 22
        public static let cardMax: CGFloat = 28
    }

    /// Dauer in Sekunden (Übergänge höchstens 150 ms, 07 §8).
    public enum Motion {
        public static let fast: Double = 0.1
        public static let base: Double = 0.15
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

#if canImport(UIKit)
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#endif
