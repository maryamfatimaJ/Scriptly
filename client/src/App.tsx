import { Routes, Route } from "react-router-dom";
import { MainLayout } from "@/layouts/MainLayout";
import { RequireAuth } from "@/components/RequireAuth";
import { Home } from "@/pages/Home";
import { HowItWorks } from "@/pages/HowItWorks";
import { CapturePrescription } from "@/pages/CapturePrescription";
import { ReviewPrescription } from "@/pages/ReviewPrescription";
import { MyMedications } from "@/pages/MyMedications";
import { SchedulePage } from "@/pages/Schedule";
import { History } from "@/pages/History";
import { MedicineInformation } from "@/pages/MedicineInformation";
import { MedicineDetail } from "@/pages/MedicineDetail";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { Account } from "@/pages/Account";
import { NotFound } from "@/pages/NotFound";

export function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route path="how-it-works" element={<HowItWorks />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />

        <Route element={<RequireAuth />}>
          {/* Medicine reference lives behind auth because the API it calls
              does (server/src/routes/medicine.routes.ts). When this route
              was public and the API was not, every search returned 401 and
              the page rendered it as "no results". */}
          <Route path="medicines" element={<MedicineInformation />} />
          <Route path="medicines/:id" element={<MedicineDetail />} />
          <Route path="capture" element={<CapturePrescription />} />
          <Route path="review/:id" element={<ReviewPrescription />} />
          <Route path="medications" element={<MyMedications />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="history" element={<History />} />
          <Route path="account" element={<Account />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
