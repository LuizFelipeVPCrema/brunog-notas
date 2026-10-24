import { Routes } from '@angular/router';
import { authGuard } from './core/auth.service';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'turmas' },
      {
        path: 'turmas',
        loadComponent: () => import('./pages/overview/overview.page').then((m) => m.OverviewPage),
      },
      {
        path: 'turmas/:classId',
        loadComponent: () =>
          import('./pages/class-board/class-board.page').then((m) => m.ClassBoardPage),
      },
      {
        path: 'alunos/:studentId',
        loadComponent: () => import('./pages/student/student.page').then((m) => m.StudentPage),
      },
      {
        path: 'importar',
        loadComponent: () => import('./pages/import/import.page').then((m) => m.ImportPage),
      },
      {
        path: 'conta',
        loadComponent: () => import('./pages/account/account.page').then((m) => m.AccountPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
