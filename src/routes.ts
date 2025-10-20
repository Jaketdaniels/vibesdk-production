import type { RouteObject } from 'react-router';
import React from 'react';

import App from './App';
import Home from './routes/home';
import Profile from './routes/profile';
import Settings from './routes/settings/index';
import AppsPage from './routes/apps';
import DiscoverPage from './routes/discover';
import { ProtectedRoute } from './routes/protected-route';

// Lazy-load routes that use Monaco Editor to defer large bundle loading
const Chat = React.lazy(() => import('./routes/chat/chat'));
const AppView = React.lazy(() => import('./routes/app'));

// New: Passkey setup route for creating a passkey after email signup or for account recovery
const PasskeySetup = React.lazy(() => import('./routes/passkey-setup'));

const routes = [
	{
		path: '/',
		Component: App,
		children: [
			{
				index: true,
				Component: Home,
			},
			{
				path: 'chat/:chatId',
				Component: Chat,
			},
			{
				path: 'profile',
				element: React.createElement(ProtectedRoute, { children: React.createElement(Profile) }),
			},
			{
				path: 'settings',
				element: React.createElement(ProtectedRoute, { children: React.createElement(Settings) }),
			},
			{
				path: 'apps',
				element: React.createElement(ProtectedRoute, { children: React.createElement(AppsPage) }),
			},
			{
				path: 'app/:id',
				Component: AppView,
			},
			{
				path: 'discover',
				Component: DiscoverPage,
			},
            {
                path: 'passkey/setup',
                element: React.createElement(ProtectedRoute, { children: React.createElement(PasskeySetup) }),
            },
		],
	},
] satisfies RouteObject[];

export { routes };
