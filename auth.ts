import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { mustGetEnv } from "@/lib/env";

const allowedDomain = "vtj.co.jp";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: mustGetEnv("GOOGLE_CLIENT_ID"),
      clientSecret: mustGetEnv("GOOGLE_CLIENT_SECRET"),
      authorization: {
        params: {
          // UI上のヒント。最終的な制限はsignIn callbackで行う。
          hd: allowedDomain,
        },
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email;
      if (!email) return false;

      // 念のため（Googleは email_verified を返す）
      const emailVerified =
        profile && "email_verified" in profile ? profile.email_verified : undefined;
      if (emailVerified === false) return false;

      return email.toLowerCase().endsWith(`@${allowedDomain}`);
    },
  },
});


