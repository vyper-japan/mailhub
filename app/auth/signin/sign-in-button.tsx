"use client";

import { signIn } from "next-auth/react";

export default function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/" })}
    >
      Googleでログイン
    </button>
  );
}


