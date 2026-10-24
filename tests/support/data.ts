import { faker } from "@faker-js/faker";
import type { CreateProjectBody, RegisterBody } from "@testpulse/shared";

/** Data akun unik per pemanggilan, sehingga test bisa berjalan paralel tanpa saling bergantung. */
export function newUserData(): RegisterBody {
  return {
    name: faker.person.fullName(),
    email: `${faker.string.alphanumeric(8)}@e2e.testpulse.dev`,
    password: faker.internet.password({ length: 14 }),
  };
}

/** Nama project unik; slug dibiarkan kosong agar dibuat otomatis dari nama. */
export function newProjectData(): CreateProjectBody {
  return { name: `Proyek ${faker.string.alphanumeric({ length: 8, casing: "lower" })}` };
}
