"use client";

import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { useRouter } from "next/navigation";
import { StepUpForm } from "@/components/step-up/step-up";

export function AdminVerifyForm() {
  const router = useRouter();
  return (
    <Card>
      <CardContent className="pt-5">
        <StepUpForm
          action="admin.open"
          onVerified={() => {
            router.push("/admin");
            router.refresh();
          }}
        />
      </CardContent>
    </Card>
  );
}
