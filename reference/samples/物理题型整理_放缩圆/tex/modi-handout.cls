%% modi-handout.cls
%% 墨帝教育 · 高中物理「题型整理」单题小页册文档类
%% 编译：xelatex（或 latexmk -xelatex）
%% 版本：v1.0  2026-10-23
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{modi-handout}[2026/10/23 v1.0 Modi Education physics handout]

%=====================================================================
% 0. 类选项：teacher / student
%    其余参数请在导言区用 \modisetup{...} 设置
%=====================================================================
\newif\ifmodi@teacher
\modi@teacherfalse
\DeclareOption{teacher}{\modi@teachertrue}
\DeclareOption{student}{\modi@teacherfalse}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{ctexart}}
\ProcessOptions\relax

\LoadClass[a4paper,UTF8,fontset=none,zihao=5]{ctexart}

%=====================================================================
% 1. 字体：中文 STSong / SimHei（对应样张 STSong+STHeiti）
%          西文与数学 New Computer Modern
%=====================================================================
\RequirePackage{fontspec}
\defaultfontfeatures{Ligatures=TeX}
\setmainfont{NewCM10}[
  Extension      = .otf,
  UprightFont    = *-Book,
  BoldFont       = *-Bold,
  ItalicFont     = *-BookItalic,
  BoldItalicFont = *-BoldItalic]

\RequirePackage{unicode-math}
\setmathfont{NewCMMath-Book.otf}

% 中文字体族（fontset=none 时由本类接管）
%
% 跨机器自适应：本工程可能在多台设备 / 多个 OneDrive 副本上编译，各地安装的
% 中文字体并不一致（如 macOS 有 STSong、部分 Windows 只有 SimSun）。这里按
% 「首选 → 次选 → TeX Live 自带」的顺序探测，取第一个真实存在的字体，
% 保证任何一台机器都能编出 PDF，且优先仍用与样张一致的 STSong/SimHei。
\def\modi@song{STSong}
\IfFontExistsTF{STSong}{}{%
  \IfFontExistsTF{SimSun}{\def\modi@song{SimSun}}{%
    \IfFontExistsTF{Noto Serif CJK SC}{\def\modi@song{Noto Serif CJK SC}}{%
      \IfFontExistsTF{Source Han Serif SC}{\def\modi@song{Source Han Serif SC}}{%
        \def\modi@song{FandolSong-Regular}}}}}

\def\modi@hei{SimHei}
\IfFontExistsTF{SimHei}{}{%
  \IfFontExistsTF{Microsoft YaHei}{\def\modi@hei{Microsoft YaHei}}{%
    \IfFontExistsTF{Noto Sans CJK SC}{\def\modi@hei{Noto Sans CJK SC}}{%
      \IfFontExistsTF{Source Han Sans SC}{\def\modi@hei{Source Han Sans SC}}{%
        \def\modi@hei{FandolHei-Regular}}}}}

\def\modi@kai{STKaiti}
\IfFontExistsTF{STKaiti}{}{%
  \IfFontExistsTF{KaiTi}{\def\modi@kai{KaiTi}}{%
    \IfFontExistsTF{FandolKai-Regular}{\def\modi@kai{FandolKai-Regular}}{%
      \def\modi@kai{\modi@song}}}}

\def\modi@fs{STFangsong}
\IfFontExistsTF{STFangsong}{}{%
  \IfFontExistsTF{FangSong}{\def\modi@fs{FangSong}}{%
    \IfFontExistsTF{FandolFang-Regular}{\def\modi@fs{FandolFang-Regular}}{%
      \def\modi@fs{\modi@song}}}}

% 先用 \edef 把字体名展开成字面量，避免把宏名传给 fontspec 的键值解析
\edef\modi@fontsetup{%
  \noexpand\setCJKmainfont{\modi@song}[BoldFont=\modi@hei]%
  \noexpand\setCJKfamilyfont{zhsong}{\modi@song}[BoldFont=\modi@hei]%
  \noexpand\setCJKfamilyfont{zhhei}{\modi@hei}%
  \noexpand\setCJKfamilyfont{zhkai}{\modi@kai}%
  \noexpand\setCJKfamilyfont{zhfs}{\modi@fs}%
  \noexpand\setCJKsansfont{\modi@hei}%
  \noexpand\setCJKmonofont{\modi@hei}}
\modi@fontsetup
\typeout{[modi-handout] 中文字体: 正文=\modi@song, 标题/加粗=\modi@hei (跨机器自适应)}

% fontset=none 时 ctex 不提供字体切换命令，这里补齐
\providecommand{\songti}{\CJKfamily{zhsong}}
\providecommand{\heiti}{\CJKfamily{zhhei}}
\providecommand{\kaishu}{\CJKfamily{zhkai}}
\providecommand{\fangsong}{\CJKfamily{zhfs}}

%=====================================================================
% 2. 颜色
%=====================================================================
\RequirePackage{xcolor}
\definecolor{modiblue}{HTML}{1F4E79}      % 表头深蓝 / 表格线
\definecolor{modipaleblue}{HTML}{F2F7FC}  % 左栏（思维过程）底色
\definecolor{modicream}{HTML}{FDF8F2}     % 右栏（书写过程）底色
\definecolor{modinotegray}{HTML}{F2F2F2}  % 注释框底色
\definecolor{modiwatermark}{HTML}{EDEDED} % 水印

%=====================================================================
% 3. 页面几何（按样张实测：版心 36pt–559.28pt，A4）
%=====================================================================
\RequirePackage{geometry}
\geometry{
  a4paper,
  left       = 36pt,
  right      = 36pt,
  top        = 93pt,
  bottom     = 58pt,
  headheight = 38pt,
  headsep    = 17pt,
  footskip   = 34pt}

%=====================================================================
% 4. 行距与段落
%=====================================================================
\linespread{1.4}\selectfont
\setlength{\parindent}{1.5em}
\setlength{\parskip}{0pt}
\setlength{\emergencystretch}{1em}

%=====================================================================
% 5. 可配置参数
%=====================================================================
\RequirePackage{keyval}
\def\modi@unit{必修一\quad 常见的力}
\def\modi@phone{134-8210-2204}
\def\modi@subject{墨帝教育高中物理}
\def\modi@logo{assets/logo.png}
\define@key{modi}{unit}{\def\modi@unit{#1}}
\define@key{modi}{phone}{\def\modi@phone{#1}}
\define@key{modi}{subject}{\def\modi@subject{#1}}
\define@key{modi}{logo}{\def\modi@logo{#1}}
%% 用法：\modisetup{unit={必修一\quad 常见的力}, phone={134-8210-2204}}
\newcommand{\modisetup}[1]{\setkeys{modi}{#1}}
\newcommand{\modiunit}{\modi@unit}
\newcommand{\modiphone}{\modi@phone}
\newcommand{\modisubject}{\modi@subject}

%=====================================================================
% 6. 页眉页脚
%=====================================================================
\RequirePackage{fancyhdr}
\RequirePackage{lastpage}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\newcommand{\modi@headerleft}{%
  \smash{\raisebox{3.5pt}[0pt][0pt]{%
    \begin{tabular}[b]{@{}l@{}}
      \includegraphics[width=2.4cm]{\modi@logo}\\[3pt]
      {\songti\fontsize{11}{13}\selectfont\modi@subject}
    \end{tabular}}}}

\fancyhead[L]{\modi@headerleft}
\fancyhead[C]{\songti\fontsize{13.7}{15}\selectfont\modiphone}
\fancyhead[R]{\songti\fontsize{11}{13}\selectfont\modiunit}
\fancyfoot[C]{\songti\fontsize{10.5}{12}\selectfont
  第\ \thepage\ 页，共\ \pageref*{LastPage}\ 页}

%=====================================================================
% 7. 整页水印（斜向平铺「墨帝教研专用内部资料」）
%    文案与平铺参数是为 10 字长文案标定的：13pt × 10 字 ≈ 130pt 宽，
%    列距 200pt、行距 90pt、4 列 × 10 行，斜切 32°，四边均有出血。
%    改文案后必须重算：字号 × 字数 × 0.85 要小于列距，否则水印互相叠字。
%=====================================================================
\RequirePackage{tikz}
\RequirePackage{eso-pic}

\newcommand{\modiwatermark}[1]{%
  \def\modi@wtext{#1}}
\modiwatermark{墨帝教研专用内部资料}

\newcommand{\modi@putwatermark}{%
  \begin{tikzpicture}[overlay, x=1pt, y=1pt]
    \foreach \wr in {0,...,9}{%
      \foreach \wc in {0,...,3}{%
        \node[rotate=32,
              anchor=center,
              inner sep=0pt,
              text=modiwatermark,
              font=\fontsize{13}{13}\selectfont]
          at (\wc*200-25, \wr*90+10) {\modi@wtext};}}
  \end{tikzpicture}}

\newif\ifmodi@watermarkon
\modi@watermarkontrue
\newcommand{\modiwatermarkoff}{\modi@watermarkonfalse}
\AddToShipoutPictureBG{\ifmodi@watermarkon\modi@putwatermark\fi}

%=====================================================================
% 8. 内容层组件
%=====================================================================
\RequirePackage{modi-blocks}

%=====================================================================
% 9. 超链接（最后加载）
%=====================================================================
\RequirePackage[hidelinks,bookmarksnumbered]{hyperref}

\endinput
