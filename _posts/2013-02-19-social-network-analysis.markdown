---
layout: mylog
title: Social Network Analysis
published: false
tags:
    - Business Intelligence 
    - Course Work
---

#Network Analysis (maybe social)

#Put Definition here.

We can mostly represent data in from of graphs with node representing products, or customers. We need to find different relations in different subset of graphs. Importance of our data is not properties of single items but on the relations between different items.


####Keywords:

- Directed Graph (showing prerequist or dependency) like, Twitter follow
- Undirected () like, facebook friendship
- Bipartite (nodes can be split in two subsets, such that there is no edge in side anysubset) like, books - authors, product - buyer

First, we will refer to hyper text (test that contains links to other text) or more apropriatly in modren term web. A web of documents (lots of) can be represented as a directed graph.


<p>We take the graph \(E={e}_{ij}\): </p>
<p><code class=" has-jax">\[
\begin{aligned}
A \rightarrow B \\ 
A \rightarrow D\\ 
B \rightarrow E\\ 
C \rightarrow B\\ 
D \rightarrow C\\ 
E \rightarrow A
\end{aligned}
\]</code></p>


We take web as our first exapmle of big data, without any search engine digging for information from this huge pile of hypertext if very difficult. Lets consider how old search engines worked, some companies (Digital research) built search engine (ALTAVISTA). They used to crawl web for keywords and index web on keywords, but these initiall search engines did not give any importance to relavency.  The results were provided in almost random order, so finding relevant information on first page might not be possible. What is needed to possibly, providing relevant pages first. Google did that very well (using PageRank algorithm), and theiir solution was to include page relationships, along with indexing for keywords. They gave a relvance socre or rank to each page. Considering, web page being referred as a vote that page is ralevent (still people found SEO tricks to improve their page's rank). 

###PageRank (Algorithm)
<p>\(P_A\) Prestige (Relavance of Page A), if we can comeup with a rank for page A, than rank of A is split evenly among aall pages referred by page it.</p> 

We consider prestige as a quantity which can be exchanged among pages.

Calculation of prestige is a repeated process,

t  A   B   C   D   E <br>
0  1   0   0   0   0 <br>
1  0  1/2  0  1/2  0 <br>
2  0   0  1/2  0  1/2<br>
3 1/2 1/2  0   0   0 <br>
4  0  1/4  0  1/4 1/2


Does a distribution of prestige exist, such that it does not changes much just because of iterations.

Static version of the evulotion of process:<br>
<p><code class=" has-jax">\[
\begin{alignaaaat}
P_A, P_B, P_C, P_D, P_E \medskip s.t. \medskip P_A +...+P_E=1\ \\ 
P_A = P_E \\ 
P_B = \frac{1,2}P_A+P_C \\ 
P_C=P_D \\ 
P_D=1/2P_A\\ 
P_E=P_B\\
P_A=P_E=P_B=2*P_D = 2*P_C\\
P_C+P_A-1/2P_A
\end{alignat}
\]</code></p>

<p>So, \(P_C = \mathbf{a}\) and \(8 \mathbf{a} = 1\) or \(\mathbf{a} = \frac{1,8}\).</p>

<hr>

N: web pages
E: (e_ij) adjacency matrix 
	e_ij = 1 if i -> j else 0
d_i :  out degree of node i

'\(d_i= \sum_{j=1}^{N} e_{ij}\)'

1 <=i<=N
{P}^t + {l}_i = sum^N_j=1  e_ji/d_j * P^t_j

L = (l_ij) 1<=i,j<=N

l_ij = e_ij / d_j

P^t+1 = L^T * P^t


Refresh: Linear Algebera (Eigen Values, Eigen vectors)