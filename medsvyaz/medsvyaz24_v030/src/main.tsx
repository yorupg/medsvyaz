import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Link,Navigate,useLocation} from 'react-router-dom';
import {ArrowUpRight} from 'lucide-react';
import {Header} from './components/Header';
import {RegionProvider} from './lib';
import {Home} from './pages/Home';
import {Regions,RegionPage} from './pages/Regions';
import {Dashboard} from './pages/Dashboard';
import {Scenarios} from './pages/Scenarios';
import {Methodology} from './pages/Methodology';
import {Sources} from './pages/Sources';
import {About} from './pages/About';
import {Materials} from './pages/Materials';
import './styles.css';
import {RELEASE} from '../shared/release';
function ScrollReset(){const {pathname}=useLocation();useEffect(()=>{window.scrollTo(0,0);const title={'/':'Главная','/regions':'Каталог регионов','/dashboard':'Дашборд','/scenarios':'Сценарии','/methodology':'Методология','/sources':'Источники','/materials':'Данные и расчёты','/about':'О проекте'}[pathname];document.title=(title??'Регион')+' · МедСвязь 24/7';},[pathname]);return null;}
function App(){return <BrowserRouter><RegionProvider><ScrollReset/><a className="skip-link" href="#main-content">Перейти к содержимому</a><Header/><div id="main-content" className="app-content"><Routes><Route path="/" element={<Home/>}/><Route path="/regions" element={<Regions/>}/><Route path="/regions/:regionSlug" element={<RegionPage/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/scenarios" element={<Scenarios/>}/><Route path="/index" element={<Navigate to="/methodology" replace/>}/><Route path="/methodology" element={<Methodology/>}/><Route path="/sources" element={<Sources/>}/><Route path="/materials" element={<Materials/>}/><Route path="/about" element={<About/>}/><Route path="*" element={<div className="page not-found"><span className="eyebrow">404</span><h1>Этой страницы нет</h1><p>Вернитесь к исследованию доступных территорий.</p><Link className="btn primary" to="/regions">Каталог регионов<ArrowUpRight size={18}/></Link></div>}/></Routes></div><footer><Link className="brand" to="/"><img src="/favicon.svg" alt=""/><span>МедСвязь <b>24/7</b><small>КОМАНДА HTTPS</small></span></Link><p>Исследовательская платформа · 2026<br/>Доступность поездки не равна качеству лечения.<br/><small>Версия сайта {RELEASE}</small></p><div><Link to="/sources">Источники</Link><Link to="/materials">Данные</Link><Link to="/methodology">Методология</Link><Link to="/about">О проекте</Link></div></footer></RegionProvider></BrowserRouter>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
